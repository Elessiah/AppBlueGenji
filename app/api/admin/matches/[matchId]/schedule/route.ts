import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_SCHEDULE_WRITE_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { can } from "@/lib/shared/permissions";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Fixe (ou efface) la date de début d'un match.
 * Corps : `{ startAt: string | null }` — ISO ou valeur d'un champ
 * `datetime-local` ; `null` (ou chaîne vide) efface l'horaire. Un corps
 * illisible ou sans `startAt` est refusé : effacer un horaire prévient tous
 * les joueurs, ce ne peut être qu'un geste explicite.
 *
 * Réservé à la permission `tournaments` : arbitre et admin programment le
 * plateau. Un caster, qui porte `live` sans `tournaments`, configure la
 * diffusion d'un match mais ne décide pas de son horaire.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const throttled = enforceRateLimit(MATCH_SCHEDULE_WRITE_RULE, user.id);
  if (throttled) return throttled;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    // Trop lourd (413) ou non déclaré JSON (415) : le refus de la lecture, pas
    // une date invalide.
    return fail(bodyReadRefusal(error) ?? "INVALID_MATCH_START_AT", 400);
  }
  if (body === null || typeof body !== "object" || !("startAt" in body)) return fail("INVALID_MATCH_START_AT", 400);
  const raw = body.startAt;
  if (raw !== null && typeof raw !== "string") return fail("INVALID_MATCH_START_AT", 400);

  try {
    const startAt = await setMatchStartAt(matchId, raw, { id: user.id, pseudo: user.pseudo });
    return ok({ startAt });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "MATCH_NOT_FOUND") return fail(message, 404);
    if (message === "INVALID_MATCH_START_AT") return fail(message, 400);
    // Une panne inattendue (SQL, interblocage rejoué en vain) ne sort qu'en
    // code : son texte reste dans pm2.
    console.error("[match-schedule] mise à jour en échec", error);
    return fail("MATCH_SCHEDULE_UPDATE_FAILED", 500);
  }
}
