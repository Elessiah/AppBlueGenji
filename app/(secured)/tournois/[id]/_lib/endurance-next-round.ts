import { resolveEnduranceConfig } from "@/lib/shared/bg-survie/config";
import type { MatchFormat } from "@/lib/shared/match-format";
import type {
  EnduranceNextRoundInput,
  EnduranceNextRoundPreview,
} from "@/lib/shared/endurance-next-round/types";
import type { TournamentActionsText } from "@/lib/shared/tournament-actions-text";
import { FR_ACTIONS_TEXT } from "./actions-text";
import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";

/**
 * Aperçu de la manche suivante de BlueGenji Survie — adaptation à l'instantané
 * et libellés (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 *
 * Le calcul vit dans `lib/shared/endurance-next-round.ts` ; il est joué **côté
 * interface**, sur l'instantané que le flux pousse déjà à chaque score : aucune
 * requête de plus, et l'aperçu suit le plateau à la seconde. Tout ce qu'il lit
 * est public (classement, scores, pénalités) — le réserver à l'arbitrage est
 * une affaire d'écran, pas de secret.
 *
 * Module pur : il ne décide que de l'entrée du calcul et des phrases, jamais du
 * rendu.
 */

/**
 * Entrée du calcul, relue sur l'instantané.
 *
 * Les abandons se lisent sur le classement (statut `FORFEIT` et manche de
 * sortie), exactement comme le moteur les relit en base (`loadForfeits`) : la
 * manche manquante vaut 1 des deux côtés.
 */
export function enduranceNextRoundInput(
  endurance: EnduranceMeta,
  matches: BracketMatch[],
  format: MatchFormat | null,
): EnduranceNextRoundInput {
  return {
    config: resolveEnduranceConfig({
      startPoints: endurance.startPoints,
      winDelta: endurance.winDelta,
      lossDelta: endurance.lossDelta,
      playoffSize: endurance.playoffSize,
      maxRounds: endurance.maxRounds,
    }),
    format,
    currentRound: endurance.currentRound,
    playoffsStarted: endurance.playoffsStarted,
    teams: endurance.standings.map((standing) => ({ teamId: standing.teamId, seed: standing.seed })),
    forfeits: endurance.standings
      .filter((standing) => standing.status === "FORFEIT")
      .map((standing) => ({ teamId: standing.teamId, round: standing.eliminatedRound ?? 1 })),
    penalties: endurance.penalties.map((penalty) => ({
      teamId: penalty.teamId,
      round: penalty.round,
      points: penalty.points,
    })),
    matches: matches
      .filter((match) => match.phaseId === 0)
      .map((match) => ({
        round: match.roundNumber,
        matchNumber: match.matchNumber,
        bracket: match.bracket,
        status: match.status,
        team1Id: match.team1Id,
        team2Id: match.team2Id,
        team1Score: match.team1Score,
        team2Score: match.team2Score,
        winnerTeamId: match.winnerTeamId,
        loserTeamId: match.loserTeamId,
        forfeitTeamId: match.forfeitTeamId,
        doubleForfeit: match.doubleForfeit,
      })),
  };
}

/** Nom d'un tour d'arbre d'après son nombre de rencontres décisives. */
function playoffStageTitle(slots: number | null, text: TournamentActionsText): string {
  if (slots === 1) return text.t("nextRound.stage.final");
  if (slots === 2) return text.t("nextRound.stage.semis");
  if (slots === 3 || slots === 4) return text.t("nextRound.stage.quarters");
  if (slots !== null && slots >= 5 && slots <= 8) return text.t("nextRound.stage.roundOf16");
  return text.t("nextRound.stage.playoffs");
}

/** Titre de l'aperçu : « Manche 4/12 », ou le stade des play-offs. */
export function nextRoundTitle(
  preview: EnduranceNextRoundPreview,
  maxRounds: number | null,
  text: TournamentActionsText = FR_ACTIONS_TEXT,
): string {
  if (preview.stage === "PLAYOFFS") return playoffStageTitle(preview.decisiveSlots, text);
  return maxRounds === null
    ? text.t("nextRound.round", { round: preview.round })
    : text.t("nextRound.roundOf", { round: preview.round, max: maxRounds });
}

/** « 3 rencontres acquises sur 4 ». */
export function nextRoundSummary(preview: EnduranceNextRoundPreview, text: TournamentActionsText = FR_ACTIONS_TEXT): string {
  const known = preview.matches.filter((match) => match.teamBId !== null).length;
  const acquired = text.t("nextRound.acquired", { count: known });
  if (preview.expectedMatches === null) return acquired;
  return text.t("nextRound.acquiredOf", { acquired, expected: preview.expectedMatches });
}

/** « 2 matchs restent à jouer ». */
export function nextRoundPendingLabel(preview: EnduranceNextRoundPreview, text: TournamentActionsText = FR_ACTIONS_TEXT): string {
  return text.t("nextRound.pending", { count: preview.pendingMatches });
}

/** Phrase d'un aperçu sans rencontre acquise. */
export function nextRoundEmptyLabel(preview: EnduranceNextRoundPreview, text: TournamentActionsText = FR_ACTIONS_TEXT): string {
  if (preview.freeScore) return text.t("nextRound.empty.freeScore");
  if (preview.expectedMatches === 0) return text.t("nextRound.empty.underfilled");
  return text.t("nextRound.empty.none");
}
