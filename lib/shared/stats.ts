/**
 * Statistiques approfondies d'une équipe ou d'un joueur — logique **pure**.
 *
 * Le serveur se contente de charger deux listes brutes (les matchs terminés et
 * les participations à des tournois vus depuis l'entité), puis délègue tout le
 * calcul ici : séries, forme, différentiel de maps, répartitions, adversaires
 * privilégiés, activité mensuelle. Équipes et joueurs partagent donc exactement
 * le même barème et les mêmes définitions — un joueur ne peut plus afficher un
 * bilan incohérent avec celui de ses équipes.
 *
 * Les points de classement réutilisent `lib/shared/ranking.ts`, commun au
 * leaderboard de la landing et au seeding des modes à classement.
 */

import { rankingPoints } from "./ranking";
import type { BracketType, TournamentFormat, TournamentGame, TournamentState } from "./types";

/** Nombre de résultats retenus pour la « forme récente ». */
export const FORM_LENGTH = 5;

/** Nombre de mois couverts par la courbe d'activité. */
export const ACTIVITY_MONTHS = 12;

/** Un match terminé, vu depuis l'entité analysée. */
export type StatsMatch = {
  matchId: number;
  tournamentId: number;
  tournamentName: string;
  game: TournamentGame;
  format: TournamentFormat;
  bracket: BracketType;
  /** Date de clôture du match (ISO). Ordonne séries, forme et activité. */
  playedAt: string;
  opponentTeamId: number | null;
  opponentName: string | null;
  won: boolean;
  /** Maps gagnées par l'entité. */
  scoreFor: number;
  /** Maps gagnées par l'adversaire. */
  scoreAgainst: number;
  /** `GIVEN` = forfait de l'entité, `RECEIVED` = forfait de l'adversaire. */
  forfeit: "NONE" | "GIVEN" | "RECEIVED";
};

/** Une participation à un tournoi, vue depuis l'entité analysée. */
export type StatsTournament = {
  tournamentId: number;
  tournamentName: string;
  state: TournamentState;
  format: TournamentFormat;
  game: TournamentGame;
  finalRank: number | null;
  playedAt: string;
};

export type StreakKind = "WIN" | "LOSS" | "NONE";

export type StatsStreak = {
  kind: StreakKind;
  length: number;
};

/** Bilan sur un sous-ensemble de matchs (un jeu, un format…). */
export type StatsSplit = {
  key: string;
  label: string;
  played: number;
  won: number;
  lost: number;
  /** Ratio de victoires entre 0 et 1, `null` si aucun match. */
  winRate: number | null;
};

export type StatsOpponent = {
  teamId: number;
  teamName: string;
  played: number;
  won: number;
  lost: number;
};

export type StatsActivityPoint = {
  /** Mois au format `YYYY-MM`. */
  month: string;
  played: number;
  won: number;
};

/** Place d'une équipe au classement du site (même barème que la landing). */
export type TeamRankingPosition = {
  /** Rang, `null` si l'équipe n'a encore joué aucun match. */
  position: number | null;
  /** Nombre d'équipes ayant joué au moins un match. */
  total: number;
  points: number;
};

export type DeepStats = {
  // — Palmarès
  tournamentsPlayed: number;
  tournamentsWon: number;
  /** Tournois terminés dans les trois premiers. */
  podiums: number;
  bestRank: number | null;
  averageRank: number | null;

  // — Bilan des matchs
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  /** Ratio de victoires entre 0 et 1, `null` si aucun match joué. */
  winRate: number | null;

  // — Maps
  mapsWon: number;
  mapsLost: number;
  mapDiff: number;
  mapWinRate: number | null;

  // — Dynamique
  currentStreak: StatsStreak;
  bestWinStreak: number;
  worstLossStreak: number;
  /** Jusqu'aux `FORM_LENGTH` derniers résultats, le plus récent en tête. */
  form: ("W" | "L")[];

  // — Classement
  rankingPoints: number;

  // — Forfaits
  forfeitsGiven: number;
  forfeitsReceived: number;

  // — Répartitions (triées par volume décroissant)
  byGame: StatsSplit[];
  byFormat: StatsSplit[];

  // — Adversaires
  /** Adversaire le plus souvent battu. */
  favouriteOpponent: StatsOpponent | null;
  /** Adversaire ayant infligé le plus de défaites. */
  nemesis: StatsOpponent | null;

  // — Activité
  /** `ACTIVITY_MONTHS` derniers mois, du plus ancien au plus récent. */
  activity: StatsActivityPoint[];
  firstMatchAt: string | null;
  lastMatchAt: string | null;
};

export const GAME_STAT_LABELS: Record<TournamentGame, string> = {
  OW2: "Overwatch 2",
  MR: "Marvel Rivals",
};

export const FORMAT_STAT_LABELS: Record<TournamentFormat, string> = {
  SINGLE: "Simple élim.",
  DOUBLE: "Double élim.",
  SWISS: "Ronde suisse",
  SURVIVAL: "Survie",
  MULTI: "Multi-phases",
  BG_SURVIE: "BlueGenji Survie",
};

/** Clé `YYYY-MM` d'une date, en temps universel (comparable et stable). */
export function monthKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildActivitySkeleton(now: Date): StatsActivityPoint[] {
  const points: StatsActivityPoint[] = [];
  for (let offset = ACTIVITY_MONTHS - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    points.push({ month: monthKey(cursor), played: 0, won: 0 });
  }
  return points;
}

/** Statistiques d'une entité qui n'a encore rien joué. */
export function emptyDeepStats(now: Date = new Date()): DeepStats {
  return {
    tournamentsPlayed: 0,
    tournamentsWon: 0,
    podiums: 0,
    bestRank: null,
    averageRank: null,
    matchesPlayed: 0,
    matchesWon: 0,
    matchesLost: 0,
    winRate: null,
    mapsWon: 0,
    mapsLost: 0,
    mapDiff: 0,
    mapWinRate: null,
    currentStreak: { kind: "NONE", length: 0 },
    bestWinStreak: 0,
    worstLossStreak: 0,
    form: [],
    rankingPoints: 0,
    forfeitsGiven: 0,
    forfeitsReceived: 0,
    byGame: [],
    byFormat: [],
    favouriteOpponent: null,
    nemesis: null,
    activity: buildActivitySkeleton(now),
    firstMatchAt: null,
    lastMatchAt: null,
  };
}

function ratio(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Number((part / total).toFixed(4));
}

function toSplits<K extends string>(
  buckets: Map<K, { played: number; won: number; lost: number }>,
  label: (key: K) => string,
): StatsSplit[] {
  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      label: label(key),
      played: value.played,
      won: value.won,
      lost: value.lost,
      winRate: ratio(value.won, value.played),
    }))
    .sort((a, b) => b.played - a.played || a.label.localeCompare(b.label, "fr"));
}

/**
 * Trie les matchs du plus ancien au plus récent. Départage par `matchId` pour
 * que deux matchs clos à la même seconde gardent un ordre déterministe — sans
 * quoi séries et forme récente changeraient d'un chargement à l'autre.
 */
function chronological(matches: StatsMatch[]): StatsMatch[] {
  return [...matches].sort((a, b) => {
    const left = Date.parse(a.playedAt);
    const right = Date.parse(b.playedAt);
    if (!Number.isNaN(left) && !Number.isNaN(right) && left !== right) return left - right;
    return a.matchId - b.matchId;
  });
}

/**
 * Meilleur client / bête noire : plus gros total sur le critère, puis plus
 * grand nombre de confrontations, puis ordre alphabétique (déterminisme).
 * Renvoie `null` tant que le critère est à zéro — un adversaire jamais battu
 * n'est pas un « adversaire favori ».
 */
function pickOpponent(list: StatsOpponent[], criterion: "won" | "lost"): StatsOpponent | null {
  let best: StatsOpponent | null = null;
  for (const candidate of list) {
    if (candidate[criterion] === 0) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate[criterion] !== best[criterion]) {
      if (candidate[criterion] > best[criterion]) best = candidate;
      continue;
    }
    if (candidate.played !== best.played) {
      if (candidate.played > best.played) best = candidate;
      continue;
    }
    if (candidate.teamName.localeCompare(best.teamName, "fr") < 0) best = candidate;
  }
  return best === null ? null : { ...best };
}

/**
 * Agrège les statistiques approfondies d'une entité.
 *
 * @param matches matchs terminés, dans n'importe quel ordre (triés en interne).
 * @param tournaments participations, une entrée par tournoi.
 * @param now instant de référence de la fenêtre d'activité (injectable en test).
 */
export function computeDeepStats(
  matches: StatsMatch[],
  tournaments: StatsTournament[],
  now: Date = new Date(),
): DeepStats {
  const stats = emptyDeepStats(now);
  const ordered = chronological(matches);

  const byGame = new Map<TournamentGame, { played: number; won: number; lost: number }>();
  const byFormat = new Map<TournamentFormat, { played: number; won: number; lost: number }>();
  const opponents = new Map<number, StatsOpponent>();
  const activityIndex = new Map(stats.activity.map((point, index) => [point.month, index]));

  let runningWins = 0;
  let runningLosses = 0;

  for (const match of ordered) {
    stats.matchesPlayed += 1;
    if (match.won) stats.matchesWon += 1;
    else stats.matchesLost += 1;

    stats.mapsWon += match.scoreFor;
    stats.mapsLost += match.scoreAgainst;

    if (match.forfeit === "GIVEN") stats.forfeitsGiven += 1;
    if (match.forfeit === "RECEIVED") stats.forfeitsReceived += 1;

    // Séries : les deux compteurs avancent en parallèle, une victoire remettant
    // à zéro la série de défaites et inversement.
    if (match.won) {
      runningWins += 1;
      runningLosses = 0;
      if (runningWins > stats.bestWinStreak) stats.bestWinStreak = runningWins;
    } else {
      runningLosses += 1;
      runningWins = 0;
      if (runningLosses > stats.worstLossStreak) stats.worstLossStreak = runningLosses;
    }

    const gameBucket = byGame.get(match.game) ?? { played: 0, won: 0, lost: 0 };
    gameBucket.played += 1;
    if (match.won) gameBucket.won += 1;
    else gameBucket.lost += 1;
    byGame.set(match.game, gameBucket);

    const formatBucket = byFormat.get(match.format) ?? { played: 0, won: 0, lost: 0 };
    formatBucket.played += 1;
    if (match.won) formatBucket.won += 1;
    else formatBucket.lost += 1;
    byFormat.set(match.format, formatBucket);

    if (match.opponentTeamId !== null) {
      const entry = opponents.get(match.opponentTeamId) ?? {
        teamId: match.opponentTeamId,
        teamName: match.opponentName ?? "Équipe inconnue",
        played: 0,
        won: 0,
        lost: 0,
      };
      entry.played += 1;
      if (match.won) entry.won += 1;
      else entry.lost += 1;
      opponents.set(match.opponentTeamId, entry);
    }

    const bucketIndex = activityIndex.get(monthKey(match.playedAt));
    if (bucketIndex !== undefined) {
      stats.activity[bucketIndex].played += 1;
      if (match.won) stats.activity[bucketIndex].won += 1;
    }
  }

  if (ordered.length > 0) {
    stats.firstMatchAt = ordered[0].playedAt;
    stats.lastMatchAt = ordered[ordered.length - 1].playedAt;

    const lastWon = ordered[ordered.length - 1].won;
    stats.currentStreak = {
      kind: lastWon ? "WIN" : "LOSS",
      length: lastWon ? runningWins : runningLosses,
    };

    stats.form = ordered
      .slice(-FORM_LENGTH)
      .reverse()
      .map((match) => (match.won ? "W" : "L"));
  }

  stats.winRate = ratio(stats.matchesWon, stats.matchesPlayed);
  stats.mapDiff = stats.mapsWon - stats.mapsLost;
  stats.mapWinRate = ratio(stats.mapsWon, stats.mapsWon + stats.mapsLost);
  stats.rankingPoints = rankingPoints(stats.matchesWon, stats.matchesLost);
  stats.byGame = toSplits(byGame, (key) => GAME_STAT_LABELS[key] ?? key);
  stats.byFormat = toSplits(byFormat, (key) => FORMAT_STAT_LABELS[key] ?? key);

  const opponentList = [...opponents.values()];
  stats.favouriteOpponent = pickOpponent(opponentList, "won");
  stats.nemesis = pickOpponent(opponentList, "lost");

  const ranks: number[] = [];
  for (const tournament of tournaments) {
    stats.tournamentsPlayed += 1;
    if (tournament.finalRank === null) continue;
    ranks.push(tournament.finalRank);
    if (tournament.finalRank === 1) stats.tournamentsWon += 1;
    if (tournament.finalRank <= 3) stats.podiums += 1;
  }

  if (ranks.length > 0) {
    stats.bestRank = Math.min(...ranks);
    stats.averageRank = Number(
      (ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length).toFixed(2),
    );
  }

  return stats;
}

/** Formate un ratio 0..1 en pourcentage lisible (`"62 %"`), `"—"` si absent. */
export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)} %`;
}

/** Formate un différentiel de maps avec son signe (`"+7"`, `"-3"`, `"0"`). */
export function formatDiff(diff: number): string {
  if (diff > 0) return `+${diff}`;
  return String(diff);
}

/** Libellé français d'une série en cours (`"4 victoires d'affilée"`). */
export function formatStreak(streak: StatsStreak): string {
  if (streak.kind === "NONE" || streak.length === 0) return "Aucune série";
  const noun = streak.kind === "WIN"
    ? `victoire${streak.length > 1 ? "s" : ""}`
    : `défaite${streak.length > 1 ? "s" : ""}`;
  return `${streak.length} ${noun} d'affilée`;
}
