/**
 * Logique pure du mode de tournoi « Survie ».
 *
 * Toutes les équipes évoluent dans un unique groupe. Au départ, le classement
 * est fixé par le seeding issu du classement du site (seed = 1 pour la meilleure
 * équipe). Ensuite, à chaque round, le classement est recalculé en fonction des
 * victoires puis des défaites (la meilleure équipe en haut) et les équipes sont
 * appariées par paires adjacentes (1 vs 2, 3 vs 4, …).
 *
 * Après chaque bloc de `roundsPerCut` rounds, les deux dernières équipes encore
 * en lice sont éliminées (une seule lorsqu'il ne resterait sinon plus personne),
 * et ainsi de suite jusqu'à ce qu'il ne reste qu'une équipe championne.
 *
 * **Parité.** Un effectif impair impose une victoire d'office à chaque round, et
 * comme une coupe retire deux équipes elle conserve la parité : l'effectif
 * resterait impair jusqu'au bout. Deux mécanismes ramènent donc l'effectif à un
 * nombre pair :
 *  - un **barrage** au round 1 quand les inscriptions sont impaires : seules les
 *    deux dernières du seeding s'affrontent, le perdant est éliminé (aucune
 *    victoire d'office, les autres équipes attendent ce round-là) ;
 *  - une **coupe d'équilibrage** : une coupe retire une seule équipe (au lieu de
 *    deux) lorsque l'effectif est impair, ce qui rattrape la parité cassée par un
 *    forfait en cours de tournoi.
 *
 * Ce module ne dépend d'aucune base de données : il est entièrement testable.
 */

export type SurvivalStatus = "ACTIVE" | "ELIMINATED" | "FORFEIT";

export type SurvivalStanding = {
  teamId: number;
  /** Seed initial (1 = meilleure équipe au classement du site). */
  seed: number;
  wins: number;
  losses: number;
  status: SurvivalStatus;
  /** Round auquel l'équipe a été éliminée ou a déclaré forfait (null si active). */
  eliminatedRound: number | null;
  /** Vrai si l'équipe a déjà bénéficié d'une victoire d'office (bye). */
  hasBye: boolean;
};

export type SurvivalPairing = {
  teamAId: number;
  teamBId: number | null;
};

export type SurvivalRoundPlan = {
  pairings: SurvivalPairing[];
  /** Équipe recevant une victoire d'office ce round (nombre impair), sinon null. */
  byeTeamId: number | null;
  /**
   * Vrai si le round est un **barrage d'équilibrage** : un seul match entre les
   * deux dernières du classement, dont le perdant est éliminé pour ramener
   * l'effectif à un nombre pair. Les autres équipes ne jouent pas ce round.
   */
  isBarrage: boolean;
};

export type PlanSurvivalRoundOptions = {
  /**
   * Autorise le barrage d'équilibrage (réservé au tout premier round). Hors de
   * ce cas, un effectif impair retombe sur la victoire d'office.
   */
  allowBarrage?: boolean;
};

/**
 * Ordre de classement : victoires décroissantes, puis défaites croissantes, puis
 * seed croissant (départage stable par le classement du site). La meilleure
 * équipe se retrouve en tête du tableau.
 */
export function compareStanding(a: SurvivalStanding, b: SurvivalStanding): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.losses !== b.losses) return a.losses - b.losses;
  return a.seed - b.seed;
}

/** Renvoie les équipes encore en lice, triées par classement courant (meilleure en tête). */
export function rankActiveTeams(standings: SurvivalStanding[]): SurvivalStanding[] {
  return standings.filter((s) => s.status === "ACTIVE").sort(compareStanding);
}

/**
 * Vrai lorsqu'un effectif impair peut être ramené au pair par un barrage
 * (au moins trois équipes : à deux, l'effectif est déjà pair).
 */
export function needsBarrage(activeCount: number): boolean {
  return activeCount >= 3 && activeCount % 2 === 1;
}

/**
 * Construit l'appariement d'un round à partir des équipes actives déjà classées.
 * Paires adjacentes (1 vs 2, 3 vs 4, …).
 *
 * Effectif impair :
 *  - avec `allowBarrage` (premier round), seules les **deux dernières** du
 *    classement s'affrontent — c'est le barrage d'équilibrage, sans victoire
 *    d'office ;
 *  - sinon (parité cassée par un forfait), l'équipe la plus basse n'ayant pas
 *    encore eu de bye reçoit une victoire d'office afin de ne pas la pénaliser ;
 *    à défaut, la dernière du classement.
 */
export function planSurvivalRound(
  orderedActive: SurvivalStanding[],
  options: PlanSurvivalRoundOptions = {},
): SurvivalRoundPlan {
  const teams = [...orderedActive];
  let byeTeamId: number | null = null;

  if (options.allowBarrage && needsBarrage(teams.length)) {
    return {
      pairings: [
        {
          teamAId: teams[teams.length - 2].teamId,
          teamBId: teams[teams.length - 1].teamId,
        },
      ],
      byeTeamId: null,
      isBarrage: true,
    };
  }

  if (teams.length % 2 === 1) {
    let byeIndex = teams.length - 1;
    for (let i = teams.length - 1; i >= 0; i--) {
      if (!teams[i].hasBye) {
        byeIndex = i;
        break;
      }
    }
    byeTeamId = teams[byeIndex].teamId;
    teams.splice(byeIndex, 1);
  }

  const pairings: SurvivalPairing[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    pairings.push({ teamAId: teams[i].teamId, teamBId: teams[i + 1].teamId });
  }

  return { pairings, byeTeamId, isBarrage: false };
}

/**
 * Nombre d'équipes à éliminer lors d'une coupe : deux par défaut, **une seule**
 * quand l'effectif est impair (coupe d'équilibrage : le reliquat redevient pair,
 * donc plus aucune victoire d'office) ou quand il ne resterait sinon plus aucune
 * équipe. Zéro s'il reste au plus une équipe.
 */
export function teamsToEliminate(activeCount: number): number {
  if (activeCount <= 1) return 0;
  if (activeCount === 2) return 1;
  return activeCount % 2 === 1 ? 1 : 2;
}

/**
 * Vrai lorsque le perdant du barrage doit effectivement être éliminé : seulement
 * si l'effectif est encore impair au moment de la réconciliation. Un forfait
 * survenu pendant le barrage a pu rétablir la parité de lui-même — inutile alors
 * de sortir une équipe de plus.
 */
export function shouldEliminateBarrageLoser(activeCount: number): boolean {
  return needsBarrage(activeCount);
}

/**
 * Cadence des coupes d'un tournoi.
 *
 * Le délai avant la **première** coupe est réglable indépendamment de l'intervalle
 * entre les suivantes : on peut laisser le classement se former sur plusieurs
 * manches, puis éliminer à un rythme plus soutenu (ou l'inverse).
 */
export type SurvivalCutSchedule = {
  /** Manches jouées avant la première coupe (≥ 1). */
  roundsBeforeFirstCut: number;
  /** Manches entre deux coupes suivantes (≥ 1). */
  roundsPerCut: number;
  /** Manches de barrage, qui ne comptent pas dans la cadence. */
  barrageRounds?: number;
};

/**
 * Vrai lorsque le round donné se termine par une coupe : au round
 * `roundsBeforeFirstCut`, puis tous les `roundsPerCut` rounds. Les rounds de
 * barrage sont déduits — la cadence démarre au premier round complet.
 */
export function isCutRound(round: number, schedule: SurvivalCutSchedule): boolean {
  const { roundsBeforeFirstCut, roundsPerCut, barrageRounds = 0 } = schedule;
  if (roundsPerCut <= 0 || roundsBeforeFirstCut <= 0) return false;

  const effective = round - barrageRounds;
  if (effective < roundsBeforeFirstCut) return false;
  return (effective - roundsBeforeFirstCut) % roundsPerCut === 0;
}

/**
 * Premier round (à partir de `round` inclus) qui se termine par une coupe. Sert à
 * annoncer l'échéance dans l'interface plutôt qu'une cadence abstraite.
 */
export function nextCutRound(round: number, schedule: SurvivalCutSchedule): number {
  const { roundsBeforeFirstCut, roundsPerCut, barrageRounds = 0 } = schedule;
  if (roundsPerCut <= 0 || roundsBeforeFirstCut <= 0) return 0;

  const effective = Math.max(round - barrageRounds, 1);
  if (effective <= roundsBeforeFirstCut) return barrageRounds + roundsBeforeFirstCut;

  const blocks = Math.ceil((effective - roundsBeforeFirstCut) / roundsPerCut);
  return barrageRounds + roundsBeforeFirstCut + blocks * roundsPerCut;
}

/**
 * Sélectionne les équipes éliminées à la fin d'un round de coupe : les plus
 * basses du classement courant parmi les équipes actives.
 */
export function selectEliminatedTeamIds(
  orderedActive: SurvivalStanding[],
  count: number,
): number[] {
  if (count <= 0) return [];
  return orderedActive.slice(orderedActive.length - count).map((s) => s.teamId);
}

/** Résultat d'un match du tournoi, tel que rejoué par {@link replaySurvival}. */
export type SurvivalMatchOutcome = {
  round: number;
  /** Vrai si le match est terminé (score validé, forfait, victoire d'office). */
  completed: boolean;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  /** Victoire d'office : compte comme une victoire, mais interdit un second bye. */
  isBye: boolean;
};

/** Abandon déclaré : événement externe, non déductible des matchs. */
export type SurvivalForfeit = { teamId: number; round: number };

export type ReplaySurvivalInput = SurvivalCutSchedule & {
  teams: { teamId: number; seed: number }[];
  matches: SurvivalMatchOutcome[];
  forfeits: SurvivalForfeit[];
  barrageRounds: number;
  /** Dernier round généré (`survival_current_round`). */
  lastRound: number;
};

/**
 * Rejoue l'intégralité du tournoi depuis les résultats des matchs et renvoie
 * l'état complet des équipes (victoires, défaites, éliminations, abandons).
 *
 * **Pourquoi rejouer plutôt qu'accumuler.** Les éliminations étaient auparavant
 * écrites au fil de l'eau et jamais reprises : corriger le score d'un round de
 * coupe laissait éliminée l'équipe qui venait de gagner, et qualifiée celle qui
 * venait de perdre. En dérivant tout de l'historique, une correction de score se
 * répercute d'elle-même sur les coupes suivantes — au même titre que les
 * victoires/défaites, déjà recalculées ainsi.
 *
 * Les abandons restent fournis en entrée : ce sont des décisions humaines, pas
 * des conséquences d'un résultat.
 */
export function replaySurvival(input: ReplaySurvivalInput): SurvivalStanding[] {
  const state = new Map<number, SurvivalStanding>(
    input.teams.map((t) => [
      t.teamId,
      {
        teamId: t.teamId,
        seed: t.seed,
        wins: 0,
        losses: 0,
        status: "ACTIVE" as SurvivalStatus,
        eliminatedRound: null as number | null,
        hasBye: false,
      },
    ]),
  );

  const forfeitsByRound = new Map<number, number[]>();
  for (const forfeit of input.forfeits) {
    const round = Math.max(1, forfeit.round);
    forfeitsByRound.set(round, [...(forfeitsByRound.get(round) ?? []), forfeit.teamId]);
  }

  const activeStandings = (): SurvivalStanding[] =>
    rankActiveTeams([...state.values()]);

  const eliminate = (teamId: number, round: number, status: SurvivalStatus): void => {
    const team = state.get(teamId);
    if (!team || team.status !== "ACTIVE") return;
    team.status = status;
    team.eliminatedRound = round;
  };

  const lastRound = Math.max(input.lastRound, ...input.matches.map((m) => m.round), 0);

  for (let round = 1; round <= lastRound; round++) {
    const roundMatches = input.matches.filter((m) => m.round === round);

    // 1. Résultats du round.
    for (const match of roundMatches) {
      if (!match.completed) continue;
      if (match.winnerTeamId !== null) {
        const winner = state.get(match.winnerTeamId);
        if (winner) {
          winner.wins += 1;
          if (match.isBye) winner.hasBye = true;
        }
      }
      if (match.loserTeamId !== null) {
        const loser = state.get(match.loserTeamId);
        if (loser) loser.losses += 1;
      }
    }

    // 2. Abandons déclarés pendant ce round (avant la coupe, comme en production).
    for (const teamId of forfeitsByRound.get(round) ?? []) {
      eliminate(teamId, round, "FORFEIT");
    }

    // Une coupe ne s'applique qu'à un round entièrement joué.
    const roundComplete = roundMatches.length > 0 && roundMatches.every((m) => m.completed);
    if (!roundComplete) continue;

    // 3. Barrage : le perdant sort, si l'effectif est encore impair.
    if (input.barrageRounds > 0 && round <= input.barrageRounds) {
      if (shouldEliminateBarrageLoser(activeStandings().length)) {
        const loserId = roundMatches.find((m) => m.loserTeamId !== null)?.loserTeamId ?? null;
        if (loserId !== null) eliminate(loserId, round, "ELIMINATED");
      }
      continue;
    }

    // 4. Coupe périodique.
    if (isCutRound(round, input)) {
      const active = activeStandings();
      for (const teamId of selectEliminatedTeamIds(active, teamsToEliminate(active.length))) {
        eliminate(teamId, round, "ELIMINATED");
      }
    }
  }

  return [...state.values()];
}

/**
 * Compare deux jeux d'appariements sans tenir compte de l'ordre (ni des paires,
 * ni des équipes au sein d'une paire). Sert à décider si un round non entamé
 * doit être régénéré après une correction de score.
 */
export function samePairings(a: SurvivalRoundPlan, b: SurvivalRoundPlan): boolean {
  if (a.byeTeamId !== b.byeTeamId) return false;
  if (a.pairings.length !== b.pairings.length) return false;
  const key = (p: SurvivalPairing): string =>
    [p.teamAId, p.teamBId ?? -1].sort((x, y) => x - y).join("-");
  const left = a.pairings.map(key).sort();
  const right = b.pairings.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Attribue le classement final. La championne (dernière équipe active, ou à
 * défaut la mieux classée) obtient le rang 1 ; les autres sont ordonnées par
 * round d'élimination décroissant (éliminées tard = mieux classées), puis par
 * victoires/défaites/seed.
 */
export function computeFinalRanks(standings: SurvivalStanding[]): Map<number, number> {
  const active = standings.filter((s) => s.status === "ACTIVE").sort(compareStanding);
  const others = standings.filter((s) => s.status !== "ACTIVE");

  others.sort((a, b) => {
    const ra = a.eliminatedRound ?? 0;
    const rb = b.eliminatedRound ?? 0;
    if (rb !== ra) return rb - ra;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.seed - b.seed;
  });

  const ordered = [...active, ...others];
  const ranks = new Map<number, number>();
  ordered.forEach((s, idx) => ranks.set(s.teamId, idx + 1));
  return ranks;
}
