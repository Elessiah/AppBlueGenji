import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_SCHEDULE_WRITE_RULE } from "@/lib/server/api-guard";
import { unexpectedFailureCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";
import { setMatchScheduleDeadline } from "@/lib/server/tournaments/schedule-deadline";
import { can } from "@/lib/shared/permissions";

const REFUSALS = new Set([
  "INVALID_SCHEDULE_DEADLINE",
  "SCHEDULE_DEADLINE_TOO_SOON",
  "SCHEDULE_DEADLINE_TOO_FAR",
]);

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Fixe (ou efface) la date butoir de planification d'un match
 * (`docs/features/SCHEDULE_DEADLINE.md`). Corps : `{ deadlineAt: string | null }`
 * — ISO ; `null` efface. Un corps sans `deadlineAt` est refusé.
 *
 * Réservé à la permission `tournaments`, comme l'horaire du match : la date
 * butoir engage les engagées (double forfait si elle passe sans horaire).
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
    return fail(bodyReadRefusal(error) ?? "INVALID_SCHEDULE_DEADLINE", 400);
  }
  if (body === null || typeof body !== "object" || !("deadlineAt" in body)) return fail("INVALID_SCHEDULE_DEADLINE", 400);

  try {
    const deadlineAt = await setMatchScheduleDeadline(matchId, body.deadlineAt, { id: user.id, pseudo: user.pseudo });
    return ok({ deadlineAt });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "MATCH_NOT_FOUND") return fail(message, 404);
    if (message === "SCHEDULE_DEADLINE_NOT_ALLOWED") return fail(message, 409);
    if (REFUSALS.has(message)) return fail(message, 400);
    return fail(unexpectedFailureCode(error, "SCHEDULE_DEADLINE_UPDATE_FAILED", "[schedule-deadline] mise à jour en échec"), 500);
  }
}
