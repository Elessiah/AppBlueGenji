import { MATCH_CHECK_IN_TOGGLE_RULE } from "@/lib/server/api-guard";
import { putTournamentToggle } from "@/lib/server/tournament-toggle-route";
import { setMatchCheckIn } from "@/lib/server/tournaments/match-check-in";

/**
 * Allume ou éteint l'option « Check-in des matchs »
 * (`docs/features/MATCH_CHECK_IN_SETTING.md`). Corps : `{ enabled: boolean }`.
 *
 * Permission `tournaments`. Modifiable à tout moment jusqu'à la clôture,
 * tournoi en cours compris : un tournoi terminé est refusé (409
 * `TOURNAMENT_FINISHED`). Débit plafonné par compte. Déroulé commun :
 * `putTournamentToggle`.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return putTournamentToggle(req, context, {
    rule: MATCH_CHECK_IN_TOGGLE_RULE,
    invalidCode: "INVALID_MATCH_CHECK_IN",
    failedCode: "MATCH_CHECK_IN_UPDATE_FAILED",
    apply: (tournamentId, enabled) => setMatchCheckIn(tournamentId, enabled),
    logOn: "MATCH_CHECK_IN_ON",
    logOff: "MATCH_CHECK_IN_OFF",
  });
}
