import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_CHECK_IN_TOGGLE_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { setMatchCheckIn } from "@/lib/server/tournaments/match-check-in";
import { announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";
import { can } from "@/lib/shared/permissions";

/**
 * Allume ou éteint l'option « Check-in des matchs »
 * (`docs/features/MATCH_CHECK_IN_SETTING.md`). Corps : `{ enabled: boolean }`
 * — un booléen strict.
 *
 * Permission `tournaments`. Modifiable à tout moment jusqu'à la clôture,
 * tournoi en cours compris : un tournoi terminé est refusé (409
 * `TOURNAMENT_FINISHED`). Débit plafonné par compte. Journalisé seulement s'il
 * change la valeur, auteur anonyme sur Discord (`STAFF_ACTION_LOGS.md`).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const throttled = enforceRateLimit(MATCH_CHECK_IN_TOGGLE_RULE, user.id);
  if (throttled) return throttled;

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return read.refusal;
  const body = read.body as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return fail("INVALID_MATCH_CHECK_IN", 400);

  try {
    const result = await setMatchCheckIn(tournamentId, body.enabled);
    if (result.changed) {
      announceStaffTournamentAction(tournamentId, result.enabled ? "MATCH_CHECK_IN_ON" : "MATCH_CHECK_IN_OFF");
    }
    return ok({ enabled: result.enabled, changed: result.changed });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message === "TOURNAMENT_FINISHED") return fail(message, 409);
    return fail("MATCH_CHECK_IN_UPDATE_FAILED", 500);
  }
}
