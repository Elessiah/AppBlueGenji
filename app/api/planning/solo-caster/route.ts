import { PLANNING_WRITE_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { createKeyedSerial } from "@/lib/server/coalescer";
import { fail, ok } from "@/lib/server/http";
import { setSoloCaster } from "@/lib/server/planning/actions";
import { announceSoloCasterChange } from "@/lib/server/planning/notices";
import { planningFailure } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { isPositiveId } from "@/lib/server/tournaments/match-launch-routes";
import { staffActor } from "@/lib/shared/log-privacy";
import { can } from "@/lib/shared/permissions";

/**
 * Réglage « caster autonome » (il diffuse seul, sans prod). Corps :
 * `{ solo: boolean, userId?: number }`. Sans `userId` (ou le sien) : un
 * caster règle le sien (permission `planning`) ; pour un autre compte, la
 * permission `tournaments` (le staff des tournois) est requise — ce geste n'est
 * pas réservé aux administrateurs, contrairement au calcul du planning.
 *
 * Un réglage **changé** sur le compte d'un autre est journalisé (anonyme sur
 * Discord, l'auteur nommé dans pm2) et annoncé au caster
 * (`PLANNING_SOLO_CASTER`) ; son propre réglage, ou une valeur reposée, rien.
 * Les gestes sur un même compte passent à tour de rôle, l'annonce mise en file
 * dans le tour de son écriture : les avis suivent l'ordre des commits.
 */
const soloCasterWrites = createKeyedSerial<number>();

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "planning")) return fail("PLANNING_MEMBERS_ONLY", 403);
  const throttled = enforceRateLimit(PLANNING_WRITE_RULE, user.id);
  if (throttled) return throttled;

  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const { solo, userId } = read.body;
  if (typeof solo !== "boolean") return fail("INVALID_SOLO", 400);
  if (userId !== undefined && !isPositiveId(userId)) return fail("INVALID_USER_ID", 400);
  const target = userId ?? user.id;
  if (target !== user.id && !can(user, "tournaments")) return fail("FORBIDDEN", 403);

  try {
    await soloCasterWrites.run(target, async () => {
      const changed = await setSoloCaster(target, solo);
      // Sans l'attendre : l'avis ne lève jamais, et un bot lent ne retarde pas
      // le geste ; mis en file ici, avant que le geste suivant n'écrive.
      if (changed && target !== user.id) void announceSoloCasterChange(target, solo, staffActor(user));
    });
    return ok({ saved: true });
  } catch (error) {
    return planningFailure(error, "PLANNING_SOLO_FAILED");
  }
}
