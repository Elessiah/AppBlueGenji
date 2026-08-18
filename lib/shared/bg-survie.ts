/**
 * Logique pure du mode « BlueGenji Survie » (endurance).
 *
 * Deux temps :
 *
 * 1. **Phase qualificative (endurance).** Chaque équipe démarre avec un capital
 *    de points d'endurance (9 par défaut). Une victoire de map en rapporte,
 *    une défaite en retire. À 0, l'équipe est éliminée sur-le-champ. Le
 *    classement se relit avant chaque manche : d'abord par endurance
 *    décroissante, puis — à égalité — dans l'**ordre du classement précédent**.
 *    Les équipes s'apparient par couples adjacents (1 vs 2, 3 vs 4, …) ; sur un
 *    effectif impair, la dernière du classement ne joue pas et son capital est
 *    inchangé. La mieux classée du couple part à gauche.
 *    La phase s'arrête dès qu'il ne reste plus que `playoffSize` équipes
 *    (8 par défaut) ou moins.
 *
 * 2. **Phase éliminatoire.** Les qualifiées jouent un arbre à élimination
 *    directe dont les affrontements suivent un tableau fixe (8v4, 6v2, 1v5,
 *    3v7), et non le seeding classique 1v8 / 2v7. Une petite finale départage
 *    la 3ᵉ place en parallèle de la finale.
 *
 * Comme la Survie et la Ronde suisse, **tout est rejoué** depuis l'historique
 * des matchs : l'endurance, les éliminations et le classement sont dérivés, ce
 * qui rend une correction de score idempotente. Seuls le classement initial
 * (ordre fixé par l'arbitre) et les abandons sont fournis en entrée.
 *
 * Module pur : aucune dépendance base de données, entièrement testable.
 */

export type EnduranceStatus = "ACTIVE" | "ELIMINATED" | "FORFEIT";

/** Barème d'endurance d'un tournoi. */
export type EnduranceConfig = {
  /** Capital de départ (défaut 9). */
  startPoints: number;
  /** Points gagnés par victoire de map (défaut 1). */
  winDelta: number;
  /** Points perdus par défaite de map (défaut 1). */
  lossDelta: number;
  /** Effectif de la phase éliminatoire (défaut 8). */
  playoffSize: number;
};

export const DEFAULT_ENDURANCE_CONFIG: EnduranceConfig = {
  startPoints: 9,
  winDelta: 1,
  lossDelta: 1,
  playoffSize: 8,
};

export type EnduranceStanding = {
  teamId: number;
  /** Rang initial, fixé par l'ordre de seeding (1 = tête de classement). */
  seed: number;
  points: number;
  wins: number;
  losses: number;
  status: EnduranceStatus;
  /** Manche à laquelle l'équipe est tombée à 0 (ou a abandonné). */
  eliminatedRound: number | null;
  /** Rang courant, 1 = meilleure. Les éliminées suivent les actives. */
  rank: number;
  /**
   * Position au classement **précédent**, seul départage prévu par le règlement
   * en cas d'égalité de points. Initialisée au seed (l'ordre fixé par
   * l'arbitre), puis réécrite après chaque manche.
   */
  previousRank: number;
};

export type EndurancePairing = {
  /** Équipe la mieux classée du couple → side GAUCHE. */
  teamAId: number;
  /** Side DROITE. `null` = effectif impair, la dernière ne joue pas. */
  teamBId: number | null;
};

/** Résultat d'un match tel que rejoué. */
export type EnduranceMatchOutcome = {
  round: number;
  completed: boolean;
  winnerTeamId: number | null;
  loserTeamId: number | null;
};

/** Abandon déclaré : décision humaine, non déductible des matchs. */
export type EnduranceForfeit = { teamId: number; round: number };

export type ReplayEnduranceInput = {
  teams: { teamId: number; seed: number }[];
  matches: EnduranceMatchOutcome[];
  forfeits: EnduranceForfeit[];
  config: EnduranceConfig;
  /** Dernière manche générée. */
  lastRound: number;
};

/** Normalise un barème partiel (valeurs manquantes ou absurdes → défauts). */
export function resolveEnduranceConfig(input?: Partial<EnduranceConfig> | null): EnduranceConfig {
  const start = Number(input?.startPoints);
  const win = Number(input?.winDelta);
  const loss = Number(input?.lossDelta);
  const playoff = Number(input?.playoffSize);

  return {
    startPoints: Number.isFinite(start) && start > 0 ? Math.floor(start) : DEFAULT_ENDURANCE_CONFIG.startPoints,
    winDelta: Number.isFinite(win) && win > 0 ? Math.floor(win) : DEFAULT_ENDURANCE_CONFIG.winDelta,
    lossDelta: Number.isFinite(loss) && loss > 0 ? Math.floor(loss) : DEFAULT_ENDURANCE_CONFIG.lossDelta,
    playoffSize:
      Number.isFinite(playoff) && playoff >= 2 ? Math.floor(playoff) : DEFAULT_ENDURANCE_CONFIG.playoffSize,
  };
}

/**
 * Ordre de classement : endurance décroissante, puis — à égalité — l'ordre du
 * classement précédent, comme l'impose le règlement.
 *
 * Attention, ce n'est **pas** équivalent à départager par le seed initial : deux
 * équipes qui se croisent en cours de route conservent leur ordre relatif du
 * moment, pas celui du départ.
 */
export function compareEndurance(a: EnduranceStanding, b: EnduranceStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  return a.previousRank - b.previousRank;
}

/** Équipes encore en lice, de la meilleure à la moins bonne. */
export function rankActiveTeams(standings: EnduranceStanding[]): EnduranceStanding[] {
  return standings.filter((s) => s.status === "ACTIVE").sort(compareEndurance);
}

/**
 * Appariement d'une manche : couples adjacents du classement courant. Sur un
 * effectif impair, la dernière équipe ne joue pas — elle ne perd ni ne gagne
 * de point (la règle ne prévoit aucune victoire d'office).
 */
export function planEnduranceRound(standings: EnduranceStanding[]): EndurancePairing[] {
  const ordered = rankActiveTeams(standings);
  const pairings: EndurancePairing[] = [];

  for (let index = 0; index + 1 < ordered.length; index += 2) {
    pairings.push({ teamAId: ordered[index].teamId, teamBId: ordered[index + 1].teamId });
  }

  if (ordered.length % 2 === 1) {
    pairings.push({ teamAId: ordered[ordered.length - 1].teamId, teamBId: null });
  }

  return pairings;
}

/** La phase qualificative est-elle terminée ? (effectif retombé à la cible) */
export function qualificationComplete(activeCount: number, config: EnduranceConfig): boolean {
  return activeCount <= config.playoffSize;
}

/**
 * Rejoue la phase qualificative et renvoie l'état complet des équipes.
 *
 * L'élimination est **immédiate** : dès que le capital atteint 0 au cours d'une
 * manche, l'équipe est sortie et ne participe plus aux suivantes — même si un
 * match ultérieur la mentionnait (cas d'un score corrigé a posteriori).
 */
export function replayEndurance(input: ReplayEnduranceInput): EnduranceStanding[] {
  const { teams, matches, forfeits, config, lastRound } = input;

  const standings = new Map<number, EnduranceStanding>(
    teams.map((team) => [
      team.teamId,
      {
        teamId: team.teamId,
        seed: team.seed,
        points: config.startPoints,
        wins: 0,
        losses: 0,
        status: "ACTIVE" as EnduranceStatus,
        eliminatedRound: null,
        rank: team.seed,
        previousRank: team.seed,
      },
    ]),
  );

  const forfeitsByRound = new Map<number, number[]>();
  for (const forfeit of forfeits) {
    const list = forfeitsByRound.get(forfeit.round) ?? [];
    list.push(forfeit.teamId);
    forfeitsByRound.set(forfeit.round, list);
  }

  const maxRound = Math.max(
    lastRound,
    ...matches.map((m) => m.round),
    ...forfeits.map((f) => f.round),
    0,
  );

  for (let round = 1; round <= maxRound; round += 1) {
    for (const match of matches) {
      if (match.round !== round || !match.completed) continue;

      const winner = match.winnerTeamId === null ? null : standings.get(match.winnerTeamId);
      const loser = match.loserTeamId === null ? null : standings.get(match.loserTeamId);

      // Un match impliquant une équipe déjà sortie ne compte pour personne : ni
      // résurrection de l'éliminée, ni point retiré à son adversaire. Le cas ne
      // devrait pas se produire (le moteur n'apparie que des équipes actives),
      // mais un score corrigé après coup peut le faire apparaître.
      if (!winner || !loser || winner.status !== "ACTIVE" || loser.status !== "ACTIVE") {
        continue;
      }

      winner.wins += 1;
      winner.points += config.winDelta;

      loser.losses += 1;
      loser.points -= config.lossDelta;
      if (loser.points <= 0) {
        loser.points = 0;
        loser.status = "ELIMINATED";
        loser.eliminatedRound = round;
      }
    }

    for (const teamId of forfeitsByRound.get(round) ?? []) {
      const standing = standings.get(teamId);
      if (standing && standing.status === "ACTIVE") {
        standing.status = "FORFEIT";
        standing.eliminatedRound = round;
        standing.points = 0;
      }
    }

    // Fige l'ordre de cette manche : il servira de départage à la suivante.
    const ordered = [...standings.values()].filter((s) => s.status === "ACTIVE").sort(compareEndurance);
    ordered.forEach((standing, index) => {
      standing.previousRank = index + 1;
    });
  }

  return assignRanks([...standings.values()]);
}

/**
 * Classe les équipes : les actives d'abord (endurance puis ordre précédent),
 * ensuite les sorties, de la dernière éliminée à la première — une équipe qui a
 * tenu plus longtemps finit devant.
 */
export function assignRanks(standings: EnduranceStanding[]): EnduranceStanding[] {
  const active = standings.filter((s) => s.status === "ACTIVE").sort(compareEndurance);

  const out = standings
    .filter((s) => s.status !== "ACTIVE")
    .sort((a, b) => {
      const roundA = a.eliminatedRound ?? 0;
      const roundB = b.eliminatedRound ?? 0;
      if (roundB !== roundA) return roundB - roundA;
      if (b.points !== a.points) return b.points - a.points;
      return a.previousRank - b.previousRank;
    });

  return [...active, ...out].map((standing, index) => ({ ...standing, rank: index + 1 }));
}

/**
 * Tableau des quarts de finale, en rangs de qualification (1 = meilleure).
 *
 * Volontairement différent d'un seeding classique : le règlement impose
 * 8v4, 6v2, 1v5 puis 3v7, dans cet ordre d'affichage. L'équipe du haut prend le
 * side gauche, celle du bas le side droite.
 */
export const PLAYOFF_QUARTER_PAIRINGS: readonly (readonly [number, number])[] = [
  [8, 4],
  [6, 2],
  [1, 5],
  [3, 7],
];

/**
 * Convertit les rangs de qualification en identifiants d'équipes pour les
 * quarts de finale. `qualified` est ordonné du 1ᵉʳ au dernier qualifié.
 *
 * @throws INVALID_PLAYOFF_FIELD si l'effectif n'est pas celui attendu.
 */
export function buildPlayoffPairings(qualified: number[]): EndurancePairing[] {
  if (qualified.length !== PLAYOFF_QUARTER_PAIRINGS.length * 2) {
    throw new Error("INVALID_PLAYOFF_FIELD");
  }

  return PLAYOFF_QUARTER_PAIRINGS.map(([topRank, bottomRank]) => ({
    teamAId: qualified[topRank - 1],
    teamBId: qualified[bottomRank - 1],
  }));
}

/** Les `playoffSize` premières équipes du classement, dans l'ordre. */
export function selectQualifiedTeamIds(
  standings: EnduranceStanding[],
  config: EnduranceConfig,
): number[] {
  return assignRanks(standings)
    .slice(0, config.playoffSize)
    .map((standing) => standing.teamId);
}
