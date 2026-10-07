import type { LaunchStripControls } from "./launch-strip";
import type { TournamentActionsText } from "@/lib/shared/tournament-actions-text";
import { FR_ACTIONS_TEXT } from "./actions-text";

/**
 * Actions d'une carte de match (`MatchRow`), rangées : **une** action
 * principale visible, les autres derrière « Plus d'actions ».
 *
 * Module pur : la carte ne choisit rien elle-même — elle lit ce que décident
 * les modules de visibilité existants (`launchStripControls`,
 * `canToggleOnAir`, `canReportOwnMatch`…) et ce module ne fait que **ranger**.
 * Aucune action ne gagne ni ne perd de public par ce rangement : la liste
 * rendue est exactement la somme de ce que chaque bandeau offrait.
 */

export type MatchCardActionId =
  | "playerScore"
  | "openLaunch"
  | "plan"
  | "adminScore"
  | "schedule"
  | "force"
  | "hostSwap"
  | "claimCast"
  | "releaseCast"
  | "onAir"
  | "liveConfig"
  | "replay"
  | "report";

export type MatchCardActionTone = "primary" | "staff" | "warn" | "neutral";

export type MatchCardAction = {
  id: MatchCardActionId;
  /** Libellé visible — le nom accessible le reprend en tête (WCAG 2.5.3). */
  label: string;
  tone: MatchCardActionTone;
};

/** Ce que le lecteur peut faire sur la carte, tel que l'ont décidé les règles existantes. */
export type MatchCardActionInput = {
  /** Libellé de la saisie joueur (`playerScoreButtonLabel`), `null` hors de son match. */
  playerScoreLabel: string | null;
  launch: LaunchStripControls;
  /** Phase de lancement `LOBBY` : l'ouverture dit « Ouvrir le lancement ». */
  inLobby: boolean;
  /** Libellé du bouton d'arbitrage, `null` quand il n'est pas offert (non arbitrable, score verrouillé). */
  adminScoreLabel: string | null;
  /** Permission `tournaments`, hors phase `TO_PLAN` (où « Planifier » prend le relais). */
  showSchedule: boolean;
  hasStartAt: boolean;
  /** Bouton d'antenne (mode `MANUAL`, permission `live`) ; `onAir` : le direct est ouvert. */
  showOnAir: boolean;
  onAir: boolean;
  showLiveConfig: boolean;
  liveConfigured: boolean;
  showReplay: boolean;
  hasReplay: boolean;
  canReport: boolean;
};

/**
 * Ordre de préséance de l'action principale : le geste qu'attend **ce**
 * lecteur sur **ce** match. Un engagé a son score à reporter ou son lancement à
 * suivre ; l'arbitrage, un match à planifier avant d'en trancher le score.
 */
const PRIMARY_ORDER: readonly MatchCardActionId[] = ["playerScore", "openLaunch", "plan", "adminScore"];

/** Toutes les actions offertes, dans l'ordre du menu. */
export function matchCardActionList(
  input: MatchCardActionInput,
  text: TournamentActionsText = FR_ACTIONS_TEXT,
): MatchCardAction[] {
  const { launch } = input;
  const { t } = text;
  const either = (flag: boolean, yes: string, no: string): string => (flag ? yes : no);
  // [offerte ?, identifiant, libellé, ton] — dans l'ordre du menu.
  const rows: [boolean, MatchCardActionId, string, MatchCardActionTone][] = [
    [input.playerScoreLabel !== null, "playerScore", input.playerScoreLabel ?? "", "primary"],
    [launch.showOpen, "openLaunch", either(input.inLobby, t("cardActions.openLaunch"), t("cardActions.matchInfo")), "primary"],
    [launch.showPlan, "plan", t("cardActions.plan"), "warn"],
    [input.adminScoreLabel !== null, "adminScore", input.adminScoreLabel ?? "", "staff"],
    [input.showSchedule, "schedule", either(input.hasStartAt, t("cardActions.editDate"), t("cardActions.setDate")), "staff"],
    [launch.showForce, "force", t("cardActions.force"), "warn"],
    [launch.showHostSwap, "hostSwap", t("cardActions.hostSwap"), "staff"],
    [launch.showClaim, "claimCast", t("cardActions.claimCast"), "neutral"],
    [launch.showRelease, "releaseCast", either(launch.isCaster, t("cardActions.stopCasting"), t("cardActions.removeCaster")), "neutral"],
    [input.showOnAir, "onAir", either(input.onAir, t("cardActions.stopLive"), t("cardActions.startLive")), "neutral"],
    [
      input.showLiveConfig,
      "liveConfig",
      either(input.liveConfigured, t("cardActions.configureStream"), t("cardActions.streamMatch")),
      "neutral",
    ],
    [input.showReplay, "replay", either(input.hasReplay, t("cardActions.editReplay"), t("cardActions.addReplay")), "neutral"],
    [input.canReport, "report", t("header.reportIssue"), "neutral"],
  ];
  return rows.filter(([offered]) => offered).map(([, id, label, tone]) => ({ id, label, tone }));
}

export type MatchCardActionGroups = {
  primary: MatchCardAction | null;
  more: MatchCardAction[];
};

/**
 * Range les actions : la première de `PRIMARY_ORDER` offerte reste visible,
 * le reste passe au menu. Une seule action en tout reste visible, quelle
 * qu'elle soit — un menu d'un seul élément ne ferait qu'ajouter un clic.
 */
export function groupMatchCardActions(actions: readonly MatchCardAction[]): MatchCardActionGroups {
  if (actions.length === 1) return { primary: actions[0], more: [] };
  const primary = PRIMARY_ORDER.map((id) => actions.find((a) => a.id === id)).find(Boolean) ?? null;
  return { primary, more: actions.filter((a) => a !== primary) };
}

/** Nom accessible : le libellé visible en tête, le match ensuite (huit cartes identiques par ronde). */
export function matchCardActionName(
  label: string,
  matchLabel: string,
  text: TournamentActionsText = FR_ACTIONS_TEXT,
): string {
  return text.t("cardActions.name", { label, match: matchLabel });
}
