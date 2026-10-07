import frTournamentDialogs from "@/messages/fr/tournamentDialogs.json";
import enTournamentDialogs from "@/messages/en/tournamentDialogs.json";
import { tournamentDialogsText, type TournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import { useTournamentActionsLocale } from "@/components/i18n/tournament-actions-text";
import {
  matchFormatLabel,
  matchMaxMaps,
  matchWinsRequired,
  type MatchFormat,
  type MatchScoreViolation,
} from "@/lib/shared/match-format";
import { MAP_SCORE_MAX, mapListLimit, type MapListViolation } from "@/lib/shared/match-maps";
import type { TournamentGame } from "@/lib/shared/types";
import type { PendingScoreProposal, ScoreFormBlocker } from "./score-form";

/**
 * Français des fenêtres d'action de la fiche (lot 8b), chargées à la demande
 * (`dynamic()` dans `page.tsx`) : importé par les fenêtres seules, il voyage
 * avec leurs morceaux plutôt qu'avec le premier chargement de la fiche — un
 * seul module pour toutes (un JSON est un module unique pour le bundler).
 * L'anglais voyage de même : le servir par la mise en page l'enverrait à
 * chaque lecteur de `/en`, fenêtre ouverte ou non. Le fournisseur ne donne que
 * la langue.
 */
export const FR_DIALOGS_TEXT: TournamentDialogsText = tournamentDialogsText("fr", frTournamentDialogs);
const EN_DIALOGS_TEXT: TournamentDialogsText = tournamentDialogsText("en", enTournamentDialogs);

/** Textes des fenêtres d'action, dans la langue de la page. */
export function useDialogsText(): TournamentDialogsText {
  return useTournamentActionsLocale() === "en" ? EN_DIALOGS_TEXT : FR_DIALOGS_TEXT;
}

/**
 * Violation de format d'un score, chiffrée (`matchScoreViolationMessage`),
 * dans la langue du texte. La notation (« BO5 · 4 maps ») est celle de
 * `matchFormatLabel`, identique dans les deux langues hormis le score libre,
 * qui n'arrive jamais ici avec un format.
 */
export function scoreViolationText(
  text: TournamentDialogsText,
  format: MatchFormat | null,
  violation: MatchScoreViolation,
): string {
  const { t } = text;
  if (violation === "DRAW_NOT_ALLOWED") return t("score.violation.draw");
  if (!format) return t("score.violation.invalid");
  const wins = matchWinsRequired(format);
  const label = matchFormatLabel(format);
  if (violation === "SCORE_EXCEEDS_MATCH_FORMAT") {
    return t("score.violation.exceeds", { label, max: matchMaxMaps(format), wins });
  }
  return t("score.violation.below", { label, wins });
}

/** Indication sur la forme d'un code de replay (`replayCodeHint`), dans la langue du texte. */
export function replayCodeHintText(text: TournamentDialogsText, game: TournamentGame | null | undefined): string {
  return text.t(game === "OW" ? "score.maps.replayHintOverwatch" : "score.maps.replayHintOther");
}

/** Refus d'une liste de maps (`mapListViolationMessage`), dans la langue du texte. */
export function mapViolationText(
  text: TournamentDialogsText,
  error: MapListViolation,
  format: MatchFormat | null,
  game?: TournamentGame | null,
): string {
  const { t } = text;
  switch (error) {
    case "MAP_LIST_EMPTY":
      return t("score.maps.violation.empty");
    case "MAP_COUNT_EXCEEDED":
      return t("score.maps.violation.tooMany", { max: mapListLimit(format) });
    case "MAP_REPLAY_CODE_REQUIRED":
      return t("score.maps.violation.codeRequired");
    case "MAP_REPLAY_CODE_INVALID":
      return t("score.maps.violation.codeInvalid", { hint: replayCodeHintText(text, game) });
    case "MAP_REPLAY_CODE_DUPLICATE":
      return t("score.maps.violation.codeDuplicate");
    case "MAP_SCORE_INVALID":
      return t("score.maps.violation.scoreInvalid", { max: MAP_SCORE_MAX });
    case "MAP_AFTER_DECISION":
      return t("score.maps.violation.afterDecision");
    case "MAP_LIST_INCOMPLETE":
      return format ? t("score.maps.violation.incomplete", { max: matchMaxMaps(format) }) : t("score.maps.violation.incompleteFree");
    case "DRAW_NOT_ALLOWED":
      return t("score.violation.draw");
    case "SCORE_EXCEEDS_MATCH_FORMAT":
      return t("score.maps.violation.tooManyWon");
    case "SCORE_BELOW_MATCH_FORMAT":
      return format ? t("score.maps.violation.below", { wins: matchWinsRequired(format) }) : t("score.maps.violation.belowFree");
  }
}

/** Phrase sous un bouton de score refusé (`scoreBlockerMessage`), dans la langue du texte. */
export function scoreBlockerText(
  text: TournamentDialogsText,
  blocker: ScoreFormBlocker,
  format: MatchFormat | null,
): string {
  const { t } = text;
  switch (blocker) {
    case "INCOMPLETE":
      return t("score.blocker.incomplete");
    case "EXCEEDS_FORMAT":
      return scoreViolationText(text, format, "SCORE_EXCEEDS_MATCH_FORMAT");
    case "BELOW_FORMAT":
      return scoreViolationText(text, format, "SCORE_BELOW_MATCH_FORMAT");
    case "DRAW":
      return t("score.blocker.draw");
    case "DOUBLE_FORFEIT":
      return t("score.blocker.doubleForfeit");
    case "NOT_IN_LAUNCH":
      return t("score.blocker.notInLaunch");
    case "ALREADY_DECIDED":
      return t("score.blocker.alreadyDecided");
  }
}

/** Score proposé et jamais confirmé, dans le dialogue d'arbitrage (`adminProposalNotice`). */
export function adminProposalText(
  text: TournamentDialogsText,
  proposal: PendingScoreProposal | null,
  team1: string,
  team2: string,
  dirty: boolean,
): string | null {
  if (!proposal) return null;
  const [author, other] = proposal.proposedBy === "team1" ? [team1, team2] : [team2, team1];
  return text.t(dirty ? "score.admin.proposalDirty" : "score.admin.proposal", {
    author,
    other,
    score1: proposal.team1Score,
    score2: proposal.team2Score,
  });
}
