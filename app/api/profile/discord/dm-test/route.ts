/**
 * « Tester mes MP » depuis « Mon profil » (`docs/features/DISCORD_DM_TEST.md`) :
 * demande au bot un message privé de test vers le Discord rattaché du compte
 * connecté, et rend l'issue (`{ outcome }`). Écriture de `/api/` qui fait
 * partir un message privé : provenance vérifiée ici en première instruction
 * (403 `CROSS_SITE_REQUEST`), sans dépendre du périmètre du middleware. Un
 * refus ne porte qu'un code.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { reserveRateLimit } from "@/lib/server/api-guard";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { DISCORD_DM_TEST_RULE, sendDiscordDmTest } from "@/lib/server/discord-dm-test";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import {
  DM_TEST_BOT_UNREACHABLE,
  DM_TEST_FAILED,
  DM_TEST_NOT_CERTIFIED,
  DM_TEST_NOT_LINKED,
} from "@/lib/shared/discord-dm-test";

/** Refus connus, rien n'est parti : la place réservée est rendue. */
const NOTHING_SENT: Readonly<Record<string, number>> = {
  PROFILE_NOT_FOUND: 404,
  [DM_TEST_NOT_LINKED]: 409,
  [DM_TEST_NOT_CERTIFIED]: 409,
};

export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: false });
  if (crossSite) return crossSite;

  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  // Réservée en une instruction, avant tout `await` : deux clics simultanés ne
  // passent pas tous deux sous le plafond.
  const reservation = reserveRateLimit(DISCORD_DM_TEST_RULE, user.id);
  if (reservation.refused) return reservation.refused;

  try {
    return ok({ outcome: await sendDiscordDmTest(user.id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = NOTHING_SENT[code];
    if (status !== undefined) {
      reservation.refund();
      return fail(code, status);
    }
    // Bot injoignable (ou trop lent, le message pouvant arriver après coup) :
    // la place reste prise (un bot en panne ne se martèle pas).
    if (code === DM_TEST_BOT_UNREACHABLE) return fail(DM_TEST_BOT_UNREACHABLE, 503);
    console.error("[profile] POST discord/dm-test failed:", failureReason(error));
    return fail(DM_TEST_FAILED, 500);
  }
}
