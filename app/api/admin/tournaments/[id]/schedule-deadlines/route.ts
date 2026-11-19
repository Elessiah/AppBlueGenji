import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_SCHEDULE_WRITE_RULE } from "@/lib/server/api-guard";
import { unexpectedFailureCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";
import { setTournamentScheduleDeadlines } from "@/lib/server/tournaments/schedule-deadline";
import { can } from "@/lib/shared/permissions";

const REFUSALS = new Set([
  "INVALID_SCHEDULE_DEADLINE",
  "SCHEDULE_DEADLINE_TOO_SOON",
  "SCHEDULE_DEADLINE_TOO_FAR",
]);

function parseTournamentId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Fixe (ou efface) d'un coup la date butoir de planification de tous les
 * matchs encore à planifier d'un tournoi (`docs/features/SCHEDULE_DEADLINE.md`).
 * Corps : `{ deadlineAt: string | null }`. Réponse : `{ count }`, les matchs touchés.
 *
 * Réservé à la permission `tournaments`.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = parseTournamentId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const throttled = enforceRateLimit(MATCH_SCHEDULE_WRITE_RULE, user.id);
  if (throttled) return throttled;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return fail(bodyReadRefusal(error) ?? "INVALID_SCHEDULE_DEADLINE", 400);
  }
  if (body === null || typeof body !== "object" || !("deadlineAt" in body)) return fail("INVALID_SCHEDULE_DEADLINE", 400);

  try {
    const count = await setTournamentScheduleDeadlines(tournamentId, body.deadlineAt, { id: user.id, pseudo: user.pseudo });
    return ok({ count });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message === "SCHEDULE_DEADLINE_NOT_ALLOWED") return fail(message, 409);
    if (REFUSALS.has(message)) return fail(message, 400);
    return fail(unexpectedFailureCode(error, "SCHEDULE_DEADLINE_UPDATE_FAILED", "[schedule-deadline] mise à jour en échec"), 500);
  }
}
