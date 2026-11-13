import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import type { RateLimitRule } from "@/lib/server/rate-limit";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";
import type { StaffTournamentAction } from "@/lib/shared/bot-logs";
import { can } from "@/lib/shared/permissions";

/** Ce qu'une bascule rend : la valeur obtenue, et si elle a réellement changé. */
export type TournamentToggleResult = { enabled: boolean; changed: boolean };

/** Ce qui est propre à une option basculée (débit, codes, service, journal). */
export type TournamentToggleSpec = {
  rule: RateLimitRule;
  /** Corps sans booléen strict `enabled` (400). */
  invalidCode: string;
  /** Échec imprévu du service (500). */
  failedCode: string;
  apply: (tournamentId: number, enabled: boolean) => Promise<TournamentToggleResult>;
  logOn: StaffTournamentAction;
  logOff: StaffTournamentAction;
};

/**
 * `PUT` d'une option de tournoi qui se bascule à tout moment jusqu'à la
 * clôture (salons vocaux d'équipe, check-in des matchs). Corps :
 * `{ enabled: boolean }` — un booléen strict.
 *
 * Déroulé, dans cet ordre : session (401 `UNAUTHORIZED`), permission
 * `tournaments` (403 `FORBIDDEN`), débit par compte (429), identifiant
 * (400 `INVALID_TOURNAMENT_ID`), corps, puis le service : tournoi introuvable
 * (404 `TOURNAMENT_NOT_FOUND`), terminé (409 `TOURNAMENT_FINISHED`), autre
 * échec (500, code de l'option). Journalisé seulement s'il change la valeur,
 * auteur anonyme sur Discord (`STAFF_ACTION_LOGS.md`).
 */
export async function putTournamentToggle(
  req: Request,
  context: { params: Promise<{ id: string }> },
  spec: TournamentToggleSpec,
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const throttled = enforceRateLimit(spec.rule, user.id);
  if (throttled) return throttled;

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return read.refusal;
  const body = read.body as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return fail(spec.invalidCode, 400);

  try {
    const result = await spec.apply(tournamentId, body.enabled);
    if (result.changed) announceStaffTournamentAction(tournamentId, result.enabled ? spec.logOn : spec.logOff);
    return ok({ enabled: result.enabled, changed: result.changed });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message === "TOURNAMENT_FINISHED") return fail(message, 409);
    return fail(spec.failedCode, 500);
  }
}
