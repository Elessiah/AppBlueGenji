import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { setRefereeObjection } from "@/lib/server/tournaments/referee-objection";
import { isPositiveId, launchFailure } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

/**
 * Retient ou lève l'opposition d'un arbitre (`docs/features/MATCH_REFEREE.md`).
 * Corps : `{ upheld: boolean }`. Retenue, elle retire l'arbitre de tous ses
 * matchs non terminés et lui ferme l'arbitrage ; levée, il peut de nouveau
 * arbitrer. Réservé à la permission `tournaments`, celle qui désigne les arbitres ;
 * retenir vise un arbitre (409 `NOT_REFEREE` sinon, `referee-objection.ts`).
 *
 * Journal : « un arbitre » et « le staff » sur Discord, le compte et l'auteur
 * dans pm2 seulement (`publishStaffAction`), et seulement sur un vrai changement.
 * Un balayage incomplet répond 500 (`REFEREE_OBJECTION_FAILED`) après le
 * journal : retenir de nouveau l'opposition le rejoue.
 */
export async function PUT(req: Request, context: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const refereeId = Number((await context.params).userId);
  if (!isPositiveId(refereeId)) return fail("INVALID_USER_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as { upheld?: unknown };
  if (typeof body.upheld !== "boolean") return fail("INVALID_REFEREE_OBJECTION", 400);
  const upheld = body.upheld;

  try {
    const result = await setRefereeObjection(refereeId, upheld);
    // Tracé dès que quelque chose a changé — y compris un balayage rejoué —,
    // et avant le refus d'un balayage incomplet : l'opposition, elle, est écrite.
    if (result.changed || result.released > 0) {
      const discordLine = upheld
        ? `🛡 Opposition d'un arbitre retenue par le staff : il est retiré de ses matchs non terminés (${result.released}).`
        : "🛡 Opposition d'un arbitre levée par le staff.";
      publishStaffAction(discordLine, { id: user.id, pseudo: user.pseudo }, `${discordLine} Arbitre : #${refereeId}.`);
    }
    if (result.failed > 0) return fail("REFEREE_OBJECTION_FAILED", 500);
    return ok({ upheld, changed: result.changed, released: result.released });
  } catch (error) {
    return launchFailure(error, { USER_NOT_FOUND: 404, NOT_REFEREE: 409 }, "REFEREE_OBJECTION_FAILED");
  }
}
