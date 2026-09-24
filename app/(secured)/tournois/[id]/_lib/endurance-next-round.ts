import { resolveEnduranceConfig } from "@/lib/shared/bg-survie";
import type { MatchFormat } from "@/lib/shared/match-format";
import type {
  EnduranceNextRoundInput,
  EnduranceNextRoundPreview,
} from "@/lib/shared/endurance-next-round";
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
function playoffStageTitle(slots: number | null): string {
  if (slots === 1) return "Finale";
  if (slots === 2) return "Demi-finales";
  if (slots === 3 || slots === 4) return "Quarts de finale";
  if (slots !== null && slots >= 5 && slots <= 8) return "8èmes de finale";
  return "Tour suivant des play-offs";
}

/**
 * Titre de l'aperçu : la manche à venir (avec son total sous plafond, comme la
 * manche courante de la vue), ou le tour d'arbre.
 */
export function nextRoundTitle(preview: EnduranceNextRoundPreview, maxRounds: number | null): string {
  if (preview.stage === "PLAYOFFS") return playoffStageTitle(preview.decisiveSlots);
  return maxRounds === null ? `Manche ${preview.round}` : `Manche ${preview.round}/${maxRounds}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

/**
 * Bilan de l'aperçu : combien de rencontres sont acquises, sur combien quand
 * l'effectif l'est. Les exemptions ne comptent pas — ce n'est pas une rencontre
 * à organiser.
 */
export function nextRoundSummary(preview: EnduranceNextRoundPreview): string {
  const known = preview.matches.filter((match) => match.teamBId !== null).length;
  const acquired = `${plural(known, "rencontre acquise", "rencontres acquises")}`;
  if (preview.expectedMatches === null) return acquired;
  return `${acquired} sur ${preview.expectedMatches}`;
}

/** Ce qui reste à jouer avant que la suite ne soit posée par le moteur. */
export function nextRoundPendingLabel(preview: EnduranceNextRoundPreview): string {
  return `${plural(preview.pendingMatches, "match reste", "matchs restent")} à jouer`;
}

/**
 * Phrase qui remplace la liste quand elle est vide — un bloc vide sous un titre
 * laisserait croire à un calcul en panne.
 */
export function nextRoundEmptyLabel(preview: EnduranceNextRoundPreview): string {
  if (preview.freeScore) {
    return "Score libre : un match restant peut déplacer un capital sans limite, rien n'est acquis avant la fin de la manche.";
  }
  if (preview.expectedMatches === 0) {
    return "Moins de deux qualifiées : le tournoi se clôturera sans arbre final.";
  }
  return "Aucune rencontre n'est encore acquise : toutes dépendent des matchs restants.";
}
