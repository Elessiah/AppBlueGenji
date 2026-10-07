import frTournamentActions from "@/messages/fr/tournamentActions.json";
import {
  tournamentActionsText,
  type TournamentActionsText,
  type TournamentErrorsText,
} from "@/lib/shared/tournament-actions-text";
import { LAUNCH_ERROR_MESSAGES } from "@/lib/shared/match-launch";
import { mapError } from "./error-map";
import { useTournamentActionsTextFrom } from "@/components/i18n/tournament-actions-text";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import type { RollbackStageDescriptor } from "@/lib/shared/tournament-rollback";
import type { AdvanceTarget } from "@/lib/shared/tournament-launch";
import type { TournamentState } from "@/lib/shared/types";

/**
 * Français des gestes rendus **avec** la fiche (lot 8b) : boutons et notices
 * d'inscription, de score, de forfait, de signalement, outils du staff posés
 * sur la page, notifications et confirmations. Il remplace les chaînes
 * écrites en dur ; l'anglais vient du fournisseur, sous `/en` seulement.
 */
export const FR_ACTIONS_TEXT: TournamentActionsText = tournamentActionsText("fr", frTournamentActions);

/** Textes des gestes de la fiche, dans la langue de la page. */
export function useActionsText(): TournamentActionsText {
  return useTournamentActionsTextFrom(FR_ACTIONS_TEXT);
}

/**
 * Manche visée par un retour en arrière (« manche 3 », « tour 2 des
 * play-offs de la phase 2 ») — `rollbackStageLabel` dans la langue du texte ;
 * `withArticle` : « la manche 3 », « le tour 2 des play-offs »
 * (`rollbackStageLabelWithArticle`), sans article en anglais.
 */
export function rollbackStageText(
  text: TournamentActionsText,
  plan: RollbackStageDescriptor,
  withArticle = false,
): string {
  const { t } = text;
  const round = plan.playoffRound
    ? t("rollback.stage.playoffRound", { round: String(plan.roundNumber - PLAYOFF_ROUND_OFFSET + 1) })
    : t("rollback.stage.round", { round: String(plan.roundNumber) });
  const stage = plan.stage.phaseRank > 0 ? t("rollback.stage.inPhase", { round, phase: String(plan.stage.phaseRank) }) : round;
  if (!withArticle) return stage;
  return t(plan.playoffRound ? "rollback.stage.thePlayoffRound" : "rollback.stage.theRound", { stage });
}

/**
 * Refus d'un geste de lancement (`launchErrorMessage`), dans la langue du
 * texte : la phrase de la table des refus, sauf `MATCH_ALREADY_COMPLETED`, que
 * le lancement formule à sa manière ; un code inconnu → phrase de repli.
 */
export function launchErrorText(
  text: TournamentActionsText,
  errors: TournamentErrorsText,
  code: string | null | undefined,
): string {
  if (!code || !Object.hasOwn(LAUNCH_ERROR_MESSAGES, code)) return text.t("launch.fallback");
  if (code === "MATCH_ALREADY_COMPLETED") return text.t("launch.alreadyCompleted");
  return mapError(code, errors);
}

/** Codes que la bascule de la planification par l'arbitrage formule elle-même (`REFEREE_SCHEDULING_ERRORS`). */
const REFEREE_SCHEDULING_CODES = ["TOURNAMENT_NOT_FOUND", "TOURNAMENT_FINISHED", "INVALID_REFEREE_SCHEDULING"] as const;

/** Refus de la bascule (`refereeSchedulingErrorMessage`), dans la langue du texte. */
export function refereeSchedulingErrorText(text: TournamentActionsText, code: string | null | undefined): string {
  const known = REFEREE_SCHEDULING_CODES.find((candidate) => candidate === code);
  return text.t(known ? `planning.errors.${known}` : "planning.errors.fallback");
}

/** Message de réussite d'une avancée anticipée (`advanceSuccessMessage`), dans la langue du texte. */
export function advanceSuccessText(
  text: TournamentActionsText,
  target: AdvanceTarget,
  state: TournamentState,
  entrantCount: number,
): string {
  const { t } = text;
  if (state === "FINISHED") return t("advance.success.closedUnderfilled");
  if (state === "RUNNING") return t("advance.success.started", { count: entrantCount });
  if (target === "REGISTRATION") return t("advance.success.registrationOpen");
  return t("advance.success.registrationClosed", { count: entrantCount });
}
