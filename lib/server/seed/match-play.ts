/**
 * Résultats des matchs simulés par le seed : un tirage reproductible, et la
 * sélection des rencontres prêtes à être jouées.
 */

import type { getMatchRows } from "../tournaments/repository";

// Les vainqueurs sont tirés au sort, mais le générateur est un LCG réamorcé pour
// chaque tournoi : deux exécutions du seed produisent exactement les mêmes
// résultats (captures d'écran, comparaisons de classements, tests manuels).
let rngState = 0;

export function seedRng(seed: number): void {
  rngState = (seed >>> 0) || 1;
}

function rng(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

// Le mieux classé (team1) l'emporte 7 fois sur 10 : assez de « upsets » pour que
// les classements et le leaderboard soient variés, sans les rendre absurdes.
// `winsRequired` = nombre de manches à gagner, dicté par le format de match du
// tournoi (3 en BO5/FT3, 2 par défaut). Sans ça, un tournoi seedé en BO5
// afficherait des scores impossibles à saisir dans l'interface.
export function playMatch(
  team1Id: number,
  team2Id: number,
  winsRequired = 2,
  // Probabilité qu'une map nulle arrête la rencontre avant l'objectif. Réservée
  // aux tournois dont le format ouvre l'égalité : ailleurs, un score nul serait
  // refusé à la saisie, et le jeu de test montrerait un match impossible à
  // reproduire dans l'interface.
  drawChance = 0
): {
  team1Score: number;
  team2Score: number;
  winnerTeamId: number | null;
  loserTeamId: number | null;
} {
  if (drawChance > 0 && rng() < drawChance) {
    // Le score d'un nul est le même des deux côtés, par définition : une manche
    // de moins que l'objectif, la dernière map ayant été partagée.
    const maps = Math.max(0, winsRequired - 1);
    return { team1Score: maps, team2Score: maps, winnerTeamId: null, loserTeamId: null };
  }

  const team1Wins = rng() < 0.7;
  const tight = rng() < 0.5;
  const winnerScore = winsRequired;
  const loserScore = tight ? winsRequired - 1 : 0;
  return {
    team1Score: team1Wins ? winnerScore : loserScore,
    team2Score: team1Wins ? loserScore : winnerScore,
    winnerTeamId: team1Wins ? team1Id : team2Id,
    loserTeamId: team1Wins ? team2Id : team1Id,
  };
}

export type MatchRowLike = Awaited<ReturnType<typeof getMatchRows>>[number];

export function readyMatches(matches: MatchRowLike[]): MatchRowLike[] {
  return matches.filter(
    (m) =>
      m.status === "READY" &&
      m.team1_id !== null &&
      m.team2_id !== null &&
      m.winner_team_id === null
  );
}
