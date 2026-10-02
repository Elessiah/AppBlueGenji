/**
 * Aperçu de la manche suivante — tour suivant d'un arbre final en cours. Une
 * rencontre y est acquise dès que ses deux rencontres d'origine sont jouées,
 * et c'est le tirage du moteur (`planNextPlayoffRound`) qui le dit
 * (`docs/features/ENDURANCE_NEXT_ROUND_PREVIEW.md`).
 *
 * Module pur : aucune dépendance base de données ni interface.
 */

import { planNextPlayoffRound } from "../bg-survie/playoffs";
import { PLAYOFF_ROUND_OFFSET } from "../bg-survie/rounds";
import type { EnduranceNextRoundInput, EnduranceNextRoundPreview } from "./types";

/**
 * Tour suivant d'un arbre final en cours : le tirage du moteur, joué sur les
 * rencontres tranchées, un vainqueur **fictif** tenant la place de chaque
 * rencontre encore ouverte. Toute rencontre planifiée sans équipe fictive est
 * acquise — elle ne dépend d'aucun match restant.
 */
export function nextPlayoffPreview(input: EnduranceNextRoundInput): EnduranceNextRoundPreview | null {
  const playoff = input.matches.filter((match) => match.round >= PLAYOFF_ROUND_OFFSET);
  if (playoff.length === 0) return null;

  const round = Math.max(...playoff.map((match) => match.round));
  const decisive = playoff
    .filter((match) => match.round === round && match.bracket !== "THIRD_PLACE")
    .sort((a, b) => a.matchNumber - b.matchNumber);
  // Une finale ne mène nulle part ; un tour tout joué est déjà suivi du suivant.
  if (decisive.length < 2) return null;
  const pendingMatches = decisive.filter((match) => match.status !== "COMPLETED").length;
  if (pendingMatches === 0) return null;

  const plan = planNextPlayoffRound(
    decisive.map((match, index) =>
      match.status === "COMPLETED"
        ? {
            winnerTeamId: match.winnerTeamId,
            loserTeamId: match.loserTeamId,
            doubleForfeit: match.doubleForfeit,
          }
        : { winnerTeamId: -(2 * index + 1), loserTeamId: -(2 * index + 2) },
    ),
  );

  const isReal = (teamId: number | null) => teamId === null || teamId > 0;
  return {
    stage: "PLAYOFFS",
    round: round + 1,
    stageCertain: true,
    freeScore: false,
    pendingMatches,
    expectedMatches: plan.filter((entry) => entry.pairing.teamBId !== null).length,
    decisiveSlots: plan.filter((entry) => entry.bracket === "UPPER").length,
    matches: plan
      .filter((entry) => isReal(entry.pairing.teamAId) && isReal(entry.pairing.teamBId))
      .map((entry) => ({
        teamAId: entry.pairing.teamAId,
        teamBId: entry.pairing.teamBId,
        sidesKnown: true,
        bracket: entry.bracket,
      })),
  };
}
