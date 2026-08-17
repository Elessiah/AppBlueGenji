/**
 * Logique pure du mode de tournoi « Ronde suisse ».
 *
 * Toutes les équipes jouent un nombre de rondes **fixé à l'avance** : personne
 * n'est éliminé. À chaque ronde, on affronte une équipe ayant accumulé un score
 * proche du sien, ce qui produit un classement fiable en beaucoup moins de matchs
 * qu'un championnat complet. Le classement final se lit aux points, départagés
 * par la difficulté du parcours (Buchholz & co.).
 *
 * **Rejeu plutôt qu'accumulation.** Comme en Survie, l'état complet (points,
 * victoires, nuls, défaites, adversaires rencontrés, rangs) est *dérivé* de
 * l'historique des matchs par {@link replaySwiss} : une correction de score
 * défait d'elle-même ses conséquences au lieu d'être ajoutée une seconde fois.
 * Seuls les abandons — décisions humaines, non déductibles d'un résultat —
 * restent fournis en entrée.
 *
 * Ce module ne dépend d'aucune base de données : il est entièrement testable.
 */

import type { SwissTiebreaker } from "./types";

/** Barème de points du tournoi (réglable à la création). */
export type SwissPointsConfig = {
  win: number;
  draw: number;
  loss: number;
  /** Points accordés pour une victoire d'office (effectif impair). */
  bye: number;
};

export const DEFAULT_SWISS_POINTS: SwissPointsConfig = {
  win: 3,
  draw: 1,
  loss: 0,
  bye: 3,
};

/** Ordre de départage par défaut, appliqué à points égaux. */
export const DEFAULT_SWISS_TIEBREAKERS: SwissTiebreaker[] = [
  "buchholz",
  "sonneborn-berger",
  "opponent-mwp",
  "head-to-head",
];

export type SwissStatus = "ACTIVE" | "FORFEIT";

export type SwissStanding = {
  teamId: number;
  /** Seed initial (1 = meilleure équipe au classement du site). */
  seed: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  /** Nombre de victoires d'office reçues (au plus une, sauf effectif dégénéré). */
  byes: number;
  /** Adversaires **programmés**, ronde en cours comprise : sert à éviter les rematchs. */
  opponentIds: number[];
  status: SwissStatus;
  /** Ronde à laquelle l'équipe a déclaré forfait (null si toujours en lice). */
  forfeitRound: number | null;
};

/**
 * Nombre de rondes recommandé : ⌈log₂(N)⌉ + 1. Une ronde de marge au-delà du
 * strict nécessaire pour départager, comme le veut l'usage.
 */
export function computeRecommendedRounds(participantCount: number): number {
  if (participantCount <= 1) return 0;
  return Math.ceil(Math.log2(participantCount)) + 1;
}

/** Affichage compact d'un total de points (`3` et non `3.0`, mais `2.5` conservé). */
export function formatPoints(points: number): string {
  return points % 1 === 0 ? String(points) : points.toFixed(1);
}

/** Résultat d'un match du tournoi, tel que rejoué par {@link replaySwiss}. */
export type SwissMatchOutcome = {
  round: number;
  /** Vrai si le match est terminé (score validé, forfait, victoire d'office). */
  completed: boolean;
  team1Id: number | null;
  team2Id: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  /** Victoire d'office : rapporte `points.bye`, et interdit un second bye. */
  isBye: boolean;
};

/** Abandon déclaré : événement externe, non déductible des matchs. */
export type SwissForfeit = { teamId: number; round: number };

export type ReplaySwissInput = {
  teams: { teamId: number; seed: number }[];
  matches: SwissMatchOutcome[];
  forfeits: SwissForfeit[];
  points: SwissPointsConfig;
};

/**
 * Rejoue l'intégralité du tournoi depuis les résultats des matchs et renvoie
 * l'état complet des équipes.
 *
 * Les adversaires sont enregistrés dès qu'un match est **programmé** (et non
 * seulement terminé) : la ronde en cours doit compter dans l'historique, sans
 * quoi la ronde suivante pourrait réapparier deux équipes qui s'affrontent au
 * moment même du calcul. Les points, eux, n'arrivent qu'au match terminé.
 */
export function replaySwiss(input: ReplaySwissInput): SwissStanding[] {
  const state = new Map<number, SwissStanding>(
    input.teams.map((t) => [
      t.teamId,
      {
        teamId: t.teamId,
        seed: t.seed,
        points: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        byes: 0,
        opponentIds: [] as number[],
        status: "ACTIVE" as SwissStatus,
        forfeitRound: null as number | null,
      },
    ]),
  );

  const ordered = [...input.matches].sort((a, b) => a.round - b.round);

  for (const match of ordered) {
    const team1 = match.team1Id === null ? undefined : state.get(match.team1Id);
    const team2 = match.team2Id === null ? undefined : state.get(match.team2Id);

    // Historique des rencontres : dès la programmation du match.
    if (team1 && team2) {
      team1.opponentIds.push(team2.teamId);
      team2.opponentIds.push(team1.teamId);
    }

    if (!match.completed) continue;

    if (match.isBye) {
      const beneficiary = match.winnerTeamId === null ? team1 : state.get(match.winnerTeamId);
      if (beneficiary) {
        beneficiary.byes += 1;
        beneficiary.points += input.points.bye;
      }
      continue;
    }

    if (!team1 || !team2) continue;

    if (match.winnerTeamId === null) {
      // Match terminé sans vainqueur : match nul.
      team1.draws += 1;
      team2.draws += 1;
      team1.points += input.points.draw;
      team2.points += input.points.draw;
      continue;
    }

    const winner = state.get(match.winnerTeamId);
    const loser =
      match.loserTeamId === null
        ? match.winnerTeamId === team1.teamId
          ? team2
          : team1
        : state.get(match.loserTeamId);

    if (winner) {
      winner.wins += 1;
      winner.points += input.points.win;
    }
    if (loser) {
      loser.losses += 1;
      loser.points += input.points.loss;
    }
  }

  for (const forfeit of input.forfeits) {
    const team = state.get(forfeit.teamId);
    if (!team) continue;
    team.status = "FORFEIT";
    team.forfeitRound = Math.max(1, forfeit.round);
  }

  return [...state.values()];
}

/** Équipes encore en lice (les abandons ne sont plus appariés). */
export function activeStandings(standings: SwissStanding[]): SwissStanding[] {
  return standings.filter((s) => s.status === "ACTIVE");
}

/** Départages calculés pour une équipe, à points égaux. */
export type SwissTiebreakScores = {
  /** Somme des points des adversaires rencontrés. */
  buchholz: number;
  /** Somme des points des adversaires battus, moitié pour les nuls. */
  sonnebornBerger: number;
  /** Pourcentage de victoires moyen des adversaires rencontrés (0–1). */
  opponentMatchWinPercent: number;
};

export type SwissRankedStanding = SwissStanding & SwissTiebreakScores & { rank: number };

/** Ratio de victoires d'une équipe sur ses matchs joués (nul = demi-victoire). */
function matchWinPercent(standing: SwissStanding): number {
  const played = standing.wins + standing.draws + standing.losses;
  if (played === 0) return 0;
  return (standing.wins + standing.draws / 2) / played;
}

/**
 * Calcule les départages de toutes les équipes.
 *
 * Buchholz mesure la difficulté du parcours (somme des points des adversaires) ;
 * Sonneborn-Berger la pondère par le résultat obtenu contre chacun ; le
 * pourcentage de victoires des adversaires lisse les écarts de barème.
 */
export function computeTiebreaks(
  standings: SwissStanding[],
  matches: SwissMatchOutcome[],
): Map<number, SwissTiebreakScores> {
  const byId = new Map(standings.map((s) => [s.teamId, s]));
  const scores = new Map<number, SwissTiebreakScores>();

  for (const standing of standings) {
    let buchholz = 0;
    let winPercentSum = 0;
    let counted = 0;

    for (const opponentId of standing.opponentIds) {
      const opponent = byId.get(opponentId);
      if (!opponent) continue;
      buchholz += opponent.points;
      winPercentSum += matchWinPercent(opponent);
      counted += 1;
    }

    let sonnebornBerger = 0;
    for (const match of matches) {
      if (!match.completed || match.isBye) continue;
      if (match.team1Id === null || match.team2Id === null) continue;
      const isTeam1 = match.team1Id === standing.teamId;
      const isTeam2 = match.team2Id === standing.teamId;
      if (!isTeam1 && !isTeam2) continue;

      const opponent = byId.get(isTeam1 ? match.team2Id : match.team1Id);
      if (!opponent) continue;

      if (match.winnerTeamId === standing.teamId) sonnebornBerger += opponent.points;
      else if (match.winnerTeamId === null) sonnebornBerger += opponent.points / 2;
    }

    scores.set(standing.teamId, {
      buchholz,
      sonnebornBerger,
      opponentMatchWinPercent: counted === 0 ? 0 : winPercentSum / counted,
    });
  }

  return scores;
}

/**
 * Bilan de chaque équipe d'un groupe d'ex æquo **contre les seules autres
 * équipes du groupe** : +1 par victoire, -1 par défaite, 0 pour un nul.
 *
 * C'est la forme « mini-championnat » de la confrontation directe. Comparer les
 * équipes deux à deux à l'intérieur d'un comparateur de tri serait incorrect :
 * si A bat B, B bat C et C bat A, le comparateur annonce A<B, B<C **et** C<A —
 * il n'est plus transitif, et `Array.prototype.sort` rend alors un ordre qui
 * dépend de l'ordre d'entrée plutôt que des résultats. Réduire la confrontation
 * directe à un score par équipe rétablit un ordre total.
 */
function headToHeadScores(
  group: SwissStanding[],
  matches: SwissMatchOutcome[],
): Map<number, number> {
  const ids = new Set(group.map((s) => s.teamId));
  const scores = new Map<number, number>(group.map((s) => [s.teamId, 0]));

  for (const match of matches) {
    if (!match.completed || match.isBye) continue;
    if (match.team1Id === null || match.team2Id === null) continue;
    if (!ids.has(match.team1Id) || !ids.has(match.team2Id)) continue;
    if (match.winnerTeamId === null) continue;

    const loserId =
      match.loserTeamId ??
      (match.winnerTeamId === match.team1Id ? match.team2Id : match.team1Id);
    scores.set(match.winnerTeamId, (scores.get(match.winnerTeamId) ?? 0) + 1);
    scores.set(loserId, (scores.get(loserId) ?? 0) - 1);
  }

  return scores;
}

/**
 * Classe les équipes : points décroissants, puis les départages configurés dans
 * l'ordre, puis le seed initial (départage stable, jamais aléatoire).
 *
 * Les équipes ayant déclaré forfait sont reléguées derrière toutes les équipes
 * encore en lice : elles n'ont pas joué le tournoi jusqu'au bout.
 *
 * La confrontation directe est appliquée **après** le tri, sur chaque groupe
 * d'équipes encore parfaitement à égalité — voir {@link headToHeadScores} pour
 * la raison (un comparateur par paires n'est pas transitif).
 */
export function rankSwiss(
  standings: SwissStanding[],
  matches: SwissMatchOutcome[],
  tiebreakers: SwissTiebreaker[] = DEFAULT_SWISS_TIEBREAKERS,
): SwissRankedStanding[] {
  const scores = computeTiebreaks(standings, matches);
  const zero: SwissTiebreakScores = {
    buchholz: 0,
    sonnebornBerger: 0,
    opponentMatchWinPercent: 0,
  };
  const scoreOf = (s: SwissStanding): SwissTiebreakScores => scores.get(s.teamId) ?? zero;

  /** Critères ordonnés, hors confrontation directe : tous des nombres. */
  const criteria: ((s: SwissStanding) => number)[] = [
    (s) => (s.status === "ACTIVE" ? 0 : 1),
    (s) => -s.points,
  ];
  for (const tiebreaker of tiebreakers) {
    if (tiebreaker === "buchholz") criteria.push((s) => -scoreOf(s).buchholz);
    if (tiebreaker === "sonneborn-berger") criteria.push((s) => -scoreOf(s).sonnebornBerger);
    if (tiebreaker === "opponent-mwp") criteria.push((s) => -scoreOf(s).opponentMatchWinPercent);
  }

  /** Vrai si les deux équipes sont indépartageables par les critères numériques. */
  const tied = (a: SwissStanding, b: SwissStanding): boolean =>
    criteria.every((key) => key(a) === key(b));

  const compare = (a: SwissStanding, b: SwissStanding): number => {
    for (const key of criteria) {
      const delta = key(a) - key(b);
      if (delta !== 0) return delta;
    }
    return a.seed - b.seed;
  };

  const ordered = [...standings].sort(compare);

  // Confrontation directe : on repère les blocs d'ex æquo parfaits et on les
  // réordonne sur leur bilan interne, puis sur le seed.
  if (tiebreakers.includes("head-to-head")) {
    for (let start = 0; start < ordered.length; ) {
      let end = start + 1;
      while (end < ordered.length && tied(ordered[start], ordered[end])) end += 1;

      if (end - start > 1) {
        const group = ordered.slice(start, end);
        const direct = headToHeadScores(group, matches);
        group.sort(
          (a, b) =>
            (direct.get(b.teamId) ?? 0) - (direct.get(a.teamId) ?? 0) || a.seed - b.seed,
        );
        ordered.splice(start, group.length, ...group);
      }

      start = end;
    }
  }

  return ordered.map((standing, index) => ({
    ...standing,
    ...scoreOf(standing),
    rank: index + 1,
  }));
}

/**
 * Classement final : identique au classement courant. En ronde suisse, le
 * tournoi ne « couronne » pas par élimination — la première du tableau après la
 * dernière ronde est championne.
 */
export function computeSwissFinalRanks(ranked: SwissRankedStanding[]): Map<number, number> {
  return new Map(ranked.map((s) => [s.teamId, s.rank]));
}

/** Le tournoi a-t-il joué toutes ses rondes ? */
export function isSwissComplete(currentRound: number, totalRounds: number): boolean {
  return totalRounds > 0 && currentRound >= totalRounds;
}
