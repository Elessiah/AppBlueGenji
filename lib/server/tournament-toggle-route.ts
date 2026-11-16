import { getCurrentUser, type AuthUser } from "@/lib/server/auth";
import { reserveRateLimit } from "@/lib/server/api-guard";
import { failureReason, serviceErrorCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import type { RateLimitRule } from "@/lib/server/rate-limit";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { announceStaffTournamentAction } from "@/lib/server/tournaments/staff-action-logs";
import type { StaffTournamentAction } from "@/lib/shared/bot-logs";
import { can } from "@/lib/shared/permissions";

/** Ce qu'une bascule rend : la valeur obtenue, et si elle a réellement changé. */
export type TournamentToggleResult = { enabled: boolean; changed: boolean };

/** Ce qui est propre à une option basculée (débit, codes, service, journal, réponse). */
export type TournamentToggleSpec<T extends TournamentToggleResult> = {
  rule: RateLimitRule;
  /** Corps sans booléen strict `enabled` (400). */
  invalidCode: string;
  /** Échec imprévu du service (500 ; une contention passagère rend 409 `CONCURRENT_UPDATE_RETRY`). */
  failedCode: string;
  apply: (tournamentId: number, enabled: boolean) => Promise<T>;
  /** Journal d'un **vrai** changement (jamais d'une requête qui ne change rien). */
  announce: (result: T, tournamentId: number, user: AuthUser) => void;
  /** Champs propres à l'option, ajoutés à `{ enabled, changed }`. */
  extra?: (result: T) => Record<string, unknown>;
};

/**
 * Journal d'une option au fil des actions du staff (`STAFF_ACTION_LOGS.md`) :
 * une action pour l'allumage, une pour l'arrêt, auteur anonyme sur Discord.
 */
export function staffToggleLog(
  logOn: StaffTournamentAction,
  logOff: StaffTournamentAction,
): (result: TournamentToggleResult, tournamentId: number) => void {
  return (result, tournamentId) => announceStaffTournamentAction(tournamentId, result.enabled ? logOn : logOff);
}

/**
 * `PUT` d'une option de tournoi qui se bascule à tout moment jusqu'à la
 * clôture (planification par l'arbitrage, salons vocaux d'équipe, check-in des
 * matchs). Corps : `{ enabled: boolean }` — un booléen strict.
 *
 * Déroulé, dans cet ordre : session (401 `UNAUTHORIZED`), permission
 * `tournaments` (403 `FORBIDDEN`), débit par compte (429), identifiant
 * (400 `INVALID_TOURNAMENT_ID`), corps, puis le service : tournoi introuvable
 * (404 `TOURNAMENT_NOT_FOUND`), terminé (409 `TOURNAMENT_FINISHED`), contention
 * passagère (409 `CONCURRENT_UPDATE_RETRY`), code du site levé par le service,
 * autre échec (500, code de l'option). Journalisé seulement s'il change la valeur.
 * Le débit est **réservé** puis rendu si la requête ne change rien ou échoue :
 * le formulaire renvoie les trois bascules à chaque enregistrement, seuls les
 * vrais changements (ceux qui écrivent au journal du staff) usent le plafond.
 */
export async function putTournamentToggle<T extends TournamentToggleResult>(
  req: Request,
  context: { params: Promise<{ id: string }> },
  spec: TournamentToggleSpec<T>,
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const slot = reserveRateLimit(spec.rule, user.id);
  if (slot.refused) return slot.refused;
  const refused = (response: Response): Response => {
    slot.refund();
    return response;
  };

  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return refused(fail("INVALID_TOURNAMENT_ID", 400));

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return refused(read.refusal);
  const body = read.body as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return refused(fail(spec.invalidCode, 400));

  let result: T;
  try {
    result = await spec.apply(tournamentId, body.enabled);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return refused(fail(message, 404));
    if (message === "TOURNAMENT_FINISHED") return refused(fail(message, 409));
    return refused(fail(serviceErrorCode(error, spec.failedCode), 500));
  }
  if (!result.changed) slot.refund();
  if (result.changed) {
    // Le changement est validé : un journal en échec ne le fait pas passer pour refusé.
    try {
      spec.announce(result, tournamentId, user);
    } catch (error) {
      console.error(`[tournament-toggle] journal du tournoi ${tournamentId} non publié`, failureReason(error));
    }
  }
  return ok({ ...spec.extra?.(result), enabled: result.enabled, changed: result.changed });
}
