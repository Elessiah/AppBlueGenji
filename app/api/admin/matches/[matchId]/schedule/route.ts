import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { can } from "@/lib/shared/permissions";

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Fixe (ou efface) la date de début d'un match.
 * Corps : `{ startAt: string | null }` — ISO ou valeur d'un champ
 * `datetime-local` ; `null` (ou chaîne vide) efface l'horaire.
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

  const body = (await req.json().catch(() => ({}))) as { startAt?: unknown };
  const raw = body.startAt ?? null;
  if (raw !== null && typeof raw !== "string") return fail("INVALID_MATCH_START_AT", 400);

  try {
    const startAt = await setMatchStartAt(matchId, raw);
    return ok({ startAt });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "MATCH_NOT_FOUND") return fail(message, 404);
    if (message === "INVALID_MATCH_START_AT") return fail(message, 400);
    return fail(message || "MATCH_SCHEDULE_UPDATE_FAILED", 500);
  }
}
