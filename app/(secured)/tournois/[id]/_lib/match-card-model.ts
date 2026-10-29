import type { BracketMatch } from "@/lib/shared/types";
import { SCORE_ENTRY_CLOSED_PHASES, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { canConfigureLive, canToggleOnAir, type MatchLiveState } from "@/lib/shared/live-streams";
import { canReportOwnMatch } from "@/lib/shared/match-card-viewer";
import {
  pendingReportState,
  playerReportView,
  playerScoreButtonKey,
  type PendingReportState,
} from "@/lib/shared/player-score-report";
import { formatMatchStartAt } from "@/lib/shared/match-schedule";
import { autoValidateTimeText } from "@/lib/shared/score-dispute";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import { useMatchLiveState } from "@/lib/shared/hooks/useMatchLiveState";
import type { TournamentActionsText } from "@/lib/shared/tournament-actions-text";
import { useSpectatorView } from "@/components/spectator-view";
import { canEditReplay } from "../_components/MatchReplayStrip";
import { usePlayerScore } from "./player-score-context";
import { useIssueReport } from "./issue-report-context";
import { useLiveControls } from "./live-context";
import { useOnMatchPage } from "./match-page-context";
import { singlePendingReport } from "./score-form";
import { launchStripControls, type LaunchStripControls } from "./launch-strip";
import { matchCardActionList, offersMatchPage, type MatchCardAction } from "./match-card-actions";
import { useActionsText } from "./actions-text";

/**
 * Libellé du bouton d'arbitrage : il dit le seul geste possible avant le
 * lancement (le forfait), et, une fois lancé, s'il reste un score proposé à
 * valider — une confirmation qui peut ne jamais venir (adversaire fantôme).
 */
function adminScoreButtonLabel(text: TournamentActionsText, scoreEntryClosed: boolean, hasProposal: boolean): string {
  if (scoreEntryClosed) return text.t("cardActions.adminForfeit");
  return text.t(hasProposal ? "cardActions.adminValidate" : "cardActions.adminEdit");
}

/** Ligne d'état d'une proposition en attente (`pendingReportState`), dans la langue de la page. */
export function pendingReportText(
  text: TournamentActionsText,
  state: PendingReportState | null,
  spectator: boolean,
): string | null {
  if (state === null) return null;
  if (state.kind === "conflict") return text.t("cardActions.reportConflict");
  const reporter = state.reporter ?? text.t("cardActions.reportSide", { side: state.side });
  // Sans compte, les scores proposés ne sont pas servis (`spectatorSnapshot`) :
  // qu'une proposition attende, sans un « 0 – 0 » qui n'a jamais été proposé —
  // l'échéance et la suspension, qui ne disent rien de personnel, restent.
  const key = spectator ? "cardActions.reportPendingSpectator" : "cardActions.reportPending";
  // Échéance de la validation d'office, lisible des deux équipes (et de tous) :
  // à l'heure de Paris, la même pour chacun (`SCORE_DISPUTE_LOCK.md`).
  const values = { score1: state.team1Score, score2: state.team2Score, reporter };
  // Suspendue par un « Enregistrer » d'arbitrage : aucune heure ne vaut plus.
  if (state.paused) return text.t(`${key}Paused`, values);
  const deadline = autoValidateTimeText(state.deadlineAt, text.locale);
  return deadline ? text.t(`${key}Deadline`, { ...values, deadline }) : text.t(key, values);
}

/** Ce que la carte d'un match et la page du match tirent des mêmes règles : phase, diffusion, gestes. */
export type MatchCardModel = {
  launchPhase: MatchLaunchPhase;
  liveState: MatchLiveState;
  launch: LaunchStripControls;
  /** Toutes les actions du lecteur, rangées par `MatchCardActions` (`MATCH_CARD_LAYOUT.md`). */
  actions: MatchCardAction[];
  /** Proposition de score en attente, lisible de tous. */
  reportNotice: string | null;
  openPlayerScore: () => void;
  openReport: () => void;
};

/**
 * Modèle d'une carte de match, **partagé** par la carte du plateau (`MatchRow`)
 * et la page du match (`MatchPage`) : la page ne reprend plus la carte, mais
 * offre exactement ses gestes — une seule définition, pour qu'aucune action
 * ne gagne ni ne perde de public d'un écran à l'autre. Chaque drapeau est
 * celui qui décidait déjà du bouton dans son ancien bandeau.
 */
export function useMatchCardModel(
  match: BracketMatch,
  adminResolvable: boolean,
  scoreLocked: boolean,
): MatchCardModel {
  const spectator = useSpectatorView();
  const actionText = useActionsText();
  const { canReport, openReport } = useIssueReport();
  // Engagé du lecteur : déjà porté par `LiveContext` (diffusion, casting) — on
  // le relit ici plutôt que d'en garder une seconde copie sur le contexte de
  // signalement, qui décrirait la même donnée depuis deux sources.
  const { myTeamId, refereeScheduling, launchPhase: launchPhaseEnabled, canManage, canSchedule, viewerUserId } =
    useLiveControls();
  // Phase de lancement, calculée **une fois par carte** et transmise aux deux
  // bandeaux : chacun posait sinon sa propre minuterie sur l'heure de départ —
  // trois `setTimeout` par match programmé, sur un plateau qui en compte 254.
  // Une chaîne : la prop reste stable, la mémorisation des bandeaux tient.
  const launchPhase = useMatchLaunchPhase({ ...match, refereeScheduling, launchPhase: launchPhaseEnabled });
  // Avant le lancement (à planifier, en attente de départ), l'arbitrage ne
  // saisit aucun score : le seul geste du dialogue est le forfait, et le bouton
  // le dit plutôt que d'annoncer une édition refusée.
  const scoreEntryClosed = SCORE_ENTRY_CLOSED_PHASES.includes(launchPhase);
  // Sous la page du match, la carte tait le lien vers elle-même ; sur une
  // exemption (un seul engagé, rien à jouer), il n'a rien à montrer.
  const showMatchPage = offersMatchPage(match, useOnMatchPage());
  // Signalement : réservé aux engagés du tournoi, au **match du lecteur**, et
  // seulement quand les deux adversaires sont connus — il n'y a rien à
  // arbitrer sur une case encore vide.
  const canReportMatch = canReportOwnMatch(canReport, myTeamId, match.team1Id, match.team2Id);
  // Saisie du score par un engagé : un bouton qui ouvre la modale joueur, et
  // non un formulaire en ligne. Le libellé annonce le geste attendu (saisir,
  // confirmer la proposition adverse, corriger la sienne).
  const playerScore = usePlayerScore();
  const canOpenPlayerScore = playerScore.canOpen(match);
  // Calculé pour les seules cartes du lecteur : le reste du plateau n'a pas de bouton.
  const playerScoreKey = canOpenPlayerScore
    ? playerScoreButtonKey(playerReportView(match, myTeamId), playerScore.canReportScore(match))
    : null;
  const playerScoreLabel = playerScoreKey === null ? null : actionText.t(`cardActions.playerScore.${playerScoreKey}`);
  // Proposition en attente, lisible de tous : sans elle, un match joué et
  // reporté se lisait exactement comme un match pas encore joué.
  const reportNotice = pendingReportText(actionText, pendingReportState(match), spectator);
  // Une proposition seule attend, même quand l'arbitrage a déjà noté un
  // avancement (suspendue ou non) : la carte garde l'appel à valider, et la
  // fenêtre d'arbitrage permet de la reprendre (`singlePendingReport`).
  const adminScoreLabel = adminScoreButtonLabel(actionText, scoreEntryClosed, singlePendingReport(match) !== null);
  // État de diffusion, calculé une fois ici : le bandeau d'horaire l'affiche,
  // le pied d'action en tire le bouton d'antenne — une seule minuterie.
  const liveState = useMatchLiveState(match);
  const launch = launchStripControls(match, launchPhase, {
    canManage,
    canSchedule,
    viewerUserId,
    myTeamId,
    launchPhase: launchPhaseEnabled,
  });
  // Toutes les actions, rangées par `MatchCardActions` : une principale
  // visible, le reste derrière « Plus d'actions » (`MATCH_CARD_LAYOUT.md`).
  const actions = matchCardActionList(
    {
      playerScoreLabel,
      // Litige : la modale n'est qu'une lecture, l'icône (œil) le dit.
      playerScoreReadOnly: playerScoreKey === "review",
      launch,
      inLobby: launchPhase === "LOBBY",
      adminScoreLabel: adminResolvable && !scoreLocked ? adminScoreLabel : null,
      showSchedule: canSchedule && launchPhase !== "TO_PLAN",
      hasStartAt: formatMatchStartAt(match.startAt) !== null,
      showOnAir: canManage && canToggleOnAir(match),
      onAir: liveState === "LIVE",
      showLiveConfig: canManage && canConfigureLive(match),
      liveConfigured: match.liveTrigger !== null,
      showReplay: canEditReplay(match, canManage),
      hasReplay: match.replayUrl !== null,
      canReport: canReportMatch,
      showMatchPage,
    },
    actionText,
  );
  return {
    launchPhase,
    liveState,
    launch,
    actions,
    reportNotice,
    openPlayerScore: () => playerScore.open(match),
    openReport: () => openReport(match),
  };
}
