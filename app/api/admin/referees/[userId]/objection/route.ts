import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { setRefereeObjection, type RefereeObjectionResult } from "@/lib/server/tournaments/referee-objection";
import { isPositiveId, launchFailure } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

/**
 * Retient ou lève l'opposition d'un arbitre (`docs/features/MATCH_REFEREE.md`).
 * Corps : `{ upheld: boolean }`. Retenue, elle retire l'arbitre de tous ses
 * matchs non terminés et lui ferme l'arbitrage ; levée, il peut de nouveau
 * arbitrer. Réservé à la permission `tournaments`, celle qui désigne les arbitres ;
 * retenir vise un arbitre (409 `NOT_REFEREE` sinon, `referee-objection.ts`).
 *
 * Journal : une seule ligne Discord, « un arbitre » et « le staff », sans nombre
 * ni ligne par match ; le compte, l'auteur et le nombre de matchs retirés dans
 * pm2 seulement (`publishStaffAction`), et seulement sur un vrai changement.
 * Un balayage incomplet répond 500 (`REFEREE_OBJECTION_FAILED`) après le
 * journal : retenir de nouveau l'opposition le rejoue. La ligne dit alors
 * « retrait incomplet », et « balayage rejoué » quand l'opposition était déjà
 * retenue. La levée répond 200 que le compte existe ou non.
 */
/** La ligne Discord du geste : anonyme, sans nombre de matchs. */
function objectionLogLine(upheld: boolean, result: RefereeObjectionResult): string {
  if (!upheld) return "🛡 Opposition d'un arbitre levée par le staff.";
  const outcome =
    result.failed > 0
      ? "retrait de ses matchs non terminés incomplet, à rejouer."
      : "il est retiré de ses matchs non terminés.";
  return result.changed
    ? `🛡 Opposition d'un arbitre retenue par le staff : ${outcome}`
    : `🛡 Opposition d'un arbitre déjà retenue, balayage rejoué par le staff : ${outcome}`;
}

export async function PUT(req: Request, context: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  // Décimal strict : `Number()` accepterait « 1e1 » ou « 0x9 ». Quinze chiffres
  // au plus : au-delà, `Number()` arrondirait vers un autre identifiant.
  const rawId = (await context.params).userId;
  const refereeId = /^[1-9]\d{0,14}$/.test(rawId) ? Number(rawId) : Number.NaN;
  if (!isPositiveId(refereeId)) return fail("INVALID_USER_ID", 400);

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return read.refusal;
  const body = read.body as { upheld?: unknown };
  if (typeof body.upheld !== "boolean") return fail("INVALID_REFEREE_OBJECTION", 400);
  const upheld = body.upheld;

  try {
    const result = await setRefereeObjection(refereeId, upheld);
    // Tracé dès que quelque chose a changé — y compris un balayage rejoué —,
    // et avant le refus d'un balayage incomplet : l'opposition, elle, est écrite.
    // Un balayage rejoué qui échoue en entier l'est aussi (auteur dans pm2).
    if (result.changed || result.released > 0 || result.failed > 0) {
      // Sur Discord, ni nombre ni ligne par match (`referee-notices.ts`) : les
      // matchs retirés désigneraient leur arbitre. Le nombre va dans pm2.
      const discordLine = objectionLogLine(upheld, result);
      const pm2Detail = upheld ? ` Matchs retirés : ${result.released}.` : "";
      publishStaffAction(discordLine, { id: user.id, pseudo: user.pseudo }, {
        auditLine: `${discordLine} Arbitre : #${refereeId}.${pm2Detail}`,
        // Une opposition retenue part toujours en alerte : l'en-tête ne dit pas
        // si l'arbitre avait des matchs ouverts (revue sécurité #536).
        category: upheld ? "staff-removal" : "referees",
      });
    }
    if (result.failed > 0) return fail("REFEREE_OBJECTION_FAILED", 500);
    return ok({ upheld, changed: result.changed, released: result.released });
  } catch (error) {
    return launchFailure(error, { USER_NOT_FOUND: 404, NOT_REFEREE: 409 }, "REFEREE_OBJECTION_FAILED");
  }
}
