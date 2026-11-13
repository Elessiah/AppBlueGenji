import type { BracketMatch } from "@/lib/shared/types";
import { shownMatchScore } from "@/lib/shared/map-points";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";

/** Ce que la carte d'un match (`MatchRow`) affiche pour l'une de ses deux lignes. */
export interface MatchSideView {
  /** La ligne porte le vainqueur. */
  win: boolean;
  /** Forfait enregistré pour cette engagée (nominatif ou double). */
  forfeits: boolean;
  /** Score affiché : « FF » sur forfait, « - » tant qu'aucun score n'est posé. */
  score: string | number;
  /** Repli du nom d'une case vide : « BYE » au premier tour (ou dans un tour de play-offs) face à une engagée, « TBD » sinon. */
  emptyLabel: "BYE" | "TBD";
}

type MatchSidesInput = Pick<
  BracketMatch,
  "team1Id" | "team2Id" | "team1Score" | "team2Score" | "winnerTeamId" | "forfeitTeamId" | "displayScore"
>;

/**
 * Les deux lignes d'une carte de match. « FF » dès que le forfait est
 * *enregistré*, sans attendre qu'il soit tranché : l'arbitrage peut noter un
 * forfait sans valider le résultat, et le score plein porté en face se lisait
 * sinon comme une rencontre jouée et gagnée. Rien de tel sur une exemption.
 * Match sur une seule carte : le score de la carte (`displayScore`, 5–3)
 * plutôt que 1–0 (`docs/features/MAP_SCORES.md`).
 */
export function matchSideViews(
  match: MatchSidesInput,
  roundNumber: number,
  doubleForfeit: boolean,
): [MatchSideView, MatchSideView] {
  const isBye = match.team1Id === null || match.team2Id === null;
  const side = (ownId: number | null, otherId: number | null, score: number | null): MatchSideView => {
    const forfeits = !isBye && (doubleForfeit || match.forfeitTeamId === ownId);
    return {
      win: match.winnerTeamId !== null && match.winnerTeamId === ownId,
      forfeits,
      score: forfeits ? "FF" : (score ?? "-"),
      emptyLabel: (roundNumber === 1 || roundNumber >= PLAYOFF_ROUND_OFFSET) && ownId === null && otherId !== null ? "BYE" : "TBD",
    };
  };
  const shown = shownMatchScore(match);
  return [side(match.team1Id, match.team2Id, shown.team1), side(match.team2Id, match.team1Id, shown.team2)];
}
