/**
 * Chargement des statistiques approfondies d'une équipe ou d'un joueur.
 *
 * Ce module ne calcule rien : il rassemble les matchs terminés et les
 * participations aux tournois, puis délègue l'agrégation à `computeDeepStats`
 * (`lib/shared/stats.ts`, pur et testable sans base). Équipes et joueurs
 * partagent donc les mêmes définitions — seule la **collecte** diffère :
 *
 * - équipe : tout son historique ;
 * - joueur : l'historique de ses équipes, **restreint aux tournois dont le
 *   déroulement chevauche ses périodes d'appartenance**. Un joueur arrivé après
 *   coup n'hérite plus du palmarès de son équipe, et un départ arrête le
 *   décompte — mais une arrivée en cours de tournoi compte bien.
 */

import type { RowDataPacket } from "mysql2";
import { getDatabase } from "./database";
import { toIso } from "./serialization";
import { parseMatchFormat } from "@/lib/shared/match-format";
import {
  compareRankedTeams,
  PLAYED_MATCH_SQL,
  rankingLossesSql,
  rankingMatchJoinSql,
  rankingPoints,
  rankingWinsSql,
} from "@/lib/shared/ranking";
import {
  computeDeepStats,
  emptyDeepStats,
  forfeitAwareMapScore,
  type DeepStats,
  type StatsMatch,
  type StatsTournament,
  type TeamRankingPosition,
} from "@/lib/shared/stats";
import type {
  BracketType,
  TeamHistoryRow,
  TournamentFormat,
  TournamentGame,
  TournamentState,
} from "@/lib/shared/types";

/**
 * Bloc statistique complet d'une entité : l'agrégat affiché en tête de fiche et
 * l'historique de tournois qui l'accompagne, **dérivés des mêmes matchs**. Les
 * deux ne peuvent donc pas se contredire, comme le faisaient les requêtes
 * d'agrégation séparées d'avant.
 */
export type EntityStats = {
  stats: DeepStats;
  /** Participations, de la plus récente à la plus ancienne. */
  tournaments: TeamHistoryRow[];
};

/** Matchs et participations retenus pour une entité, avant agrégation. */
type Collected = {
  matches: StatsMatch[];
  tournaments: StatsTournament[];
};

/**
 * Assemble l'agrégat et l'historique à partir d'une même collecte. Le bilan
 * ligne à ligne (`wins` / `losses`) est recompté depuis les matchs retenus :
 * byes et matchs fantômes en sont donc exclus là aussi.
 */
function summarize(collected: Collected): EntityStats {
  const perTournament = new Map<number, { wins: number; losses: number }>();
  for (const match of collected.matches) {
    const entry = perTournament.get(match.tournamentId) ?? { wins: 0, losses: 0 };
    if (match.won) entry.wins += 1;
    else entry.losses += 1;
    perTournament.set(match.tournamentId, entry);
  }

  const tournaments = [...collected.tournaments]
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))
    .map((tournament) => {
      const bilan = perTournament.get(tournament.tournamentId) ?? { wins: 0, losses: 0 };
      return {
        tournamentId: tournament.tournamentId,
        tournamentName: tournament.tournamentName,
        state: tournament.state,
        finalRank: tournament.finalRank,
        wins: bilan.wins,
        losses: bilan.losses,
        playedAt: tournament.playedAt,
      };
    });

  return { stats: computeDeepStats(collected.matches, collected.tournaments), tournaments };
}

type MatchStatRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  game: TournamentGame | null;
  format: TournamentFormat | null;
  bracket: BracketType;
  played_at: Date | string | null;
  team1_id: number;
  team2_id: number;
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number;
  forfeit_team_id: number | null;
  match_format_type: "BO" | "FT" | null;
  match_format_value: number | null;
};

type RegistrationStatRow = RowDataPacket & {
  team_id: number;
  tournament_id: number;
  tournament_name: string;
  state: TournamentState;
  game: TournamentGame | null;
  format: TournamentFormat | null;
  final_rank: number | null;
  played_at: Date | string | null;
  start_at: Date | string | null;
  finished_at: Date | string | null;
};

type MembershipRow = RowDataPacket & {
  team_id: number;
  joined_at: Date | string;
  left_at: Date | string | null;
};

/** Période d'appartenance d'un joueur à une équipe. */
type Membership = {
  teamId: number;
  joinedAt: number;
  /** `null` = toujours membre. */
  leftAt: number | null;
};

/**
 * Liste de placeholders `?,?,?` pour un `IN (...)`. `db.execute` ne développe
 * pas les tableaux : les identifiants restent passés en paramètres liés, jamais
 * interpolés dans le SQL.
 */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isoOrEpoch(value: Date | string | null | undefined): string {
  return toIso(value ?? null) ?? new Date(0).toISOString();
}

/**
 * Matchs terminés d'un ensemble d'équipes.
 *
 * Byes (`is_bye`) et matchs fantômes (une équipe manquante) sont écartés : leur
 * score est posé par le moteur de tournoi, pas joué — les compter gonflerait
 * artificiellement bilans et séries.
 */
async function loadMatchRows(
  db: Awaited<ReturnType<typeof getDatabase>>,
  teamIds: number[],
): Promise<MatchStatRow[]> {
  if (teamIds.length === 0) return [];
  const list = placeholders(teamIds.length);
  const [rows] = await db.execute<MatchStatRow[]>(
    `SELECT
      m.id,
      m.tournament_id,
      t.name AS tournament_name,
      t.game,
      t.format,
      m.bracket,
      COALESCE(m.updated_at, t.finished_at, t.start_at) AS played_at,
      m.team1_id,
      m.team2_id,
      t1.name AS team1_name,
      t2.name AS team2_name,
      m.team1_score,
      m.team2_score,
      m.winner_team_id,
      m.forfeit_team_id,
      t.match_format_type,
      t.match_format_value
     FROM bg_matches m
     JOIN bg_tournaments t ON t.id = m.tournament_id
     LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
     LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
     WHERE ${PLAYED_MATCH_SQL}
       AND (m.team1_id IN (${list}) OR m.team2_id IN (${list}))
     ORDER BY played_at ASC, m.id ASC`,
    [...teamIds, ...teamIds],
  );
  return rows;
}

async function loadRegistrationRows(
  db: Awaited<ReturnType<typeof getDatabase>>,
  teamIds: number[],
): Promise<RegistrationStatRow[]> {
  if (teamIds.length === 0) return [];
  const [rows] = await db.execute<RegistrationStatRow[]>(
    `SELECT
      r.team_id,
      r.tournament_id,
      t.name AS tournament_name,
      t.state,
      t.game,
      t.format,
      r.final_rank,
      COALESCE(t.finished_at, t.start_at) AS played_at,
      t.start_at,
      t.finished_at
     FROM bg_tournament_registrations r
     JOIN bg_tournaments t ON t.id = r.tournament_id
     WHERE r.team_id IN (${placeholders(teamIds.length)})
     ORDER BY played_at DESC`,
    teamIds,
  );
  return rows;
}

/** Convertit une ligne de match en fait statistique vu depuis `teamId`. */
function toStatsMatch(row: MatchStatRow, teamId: number): StatsMatch {
  const isTeam1 = Number(row.team1_id) === teamId;
  const opponentId = isTeam1 ? Number(row.team2_id) : Number(row.team1_id);
  const opponentName = isTeam1 ? row.team2_name : row.team1_name;
  const forfeitTeamId = row.forfeit_team_id === null ? null : Number(row.forfeit_team_id);

  let forfeit: StatsMatch["forfeit"] = "NONE";
  if (forfeitTeamId !== null) forfeit = forfeitTeamId === teamId ? "GIVEN" : "RECEIVED";

  // Le bilan de maps d'un forfait vient du **format** du tournoi, pas des
  // colonnes : elles sont vides sur les forfaits antérieurs à la règle.
  const maps = forfeitAwareMapScore(
    forfeit,
    parseMatchFormat(row.match_format_type, row.match_format_value),
    isTeam1 ? row.team1_score : row.team2_score,
    isTeam1 ? row.team2_score : row.team1_score,
  );

  return {
    matchId: Number(row.id),
    tournamentId: Number(row.tournament_id),
    tournamentName: row.tournament_name,
    game: row.game ?? "OW2",
    format: row.format ?? "SINGLE",
    bracket: row.bracket,
    playedAt: isoOrEpoch(row.played_at),
    opponentTeamId: opponentId,
    opponentName,
    won: Number(row.winner_team_id) === teamId,
    scoreFor: maps.scoreFor,
    scoreAgainst: maps.scoreAgainst,
    forfeit,
  };
}

function toStatsTournament(row: RegistrationStatRow): StatsTournament {
  return {
    tournamentId: Number(row.tournament_id),
    tournamentName: row.tournament_name,
    state: row.state,
    format: row.format ?? "SINGLE",
    game: row.game ?? "OW2",
    finalRank: row.final_rank === null ? null : Number(row.final_rank),
    playedAt: isoOrEpoch(row.played_at),
  };
}

/** Statistiques approfondies d'une équipe, et son historique de tournois. */
export async function getTeamEntityStats(teamId: number): Promise<EntityStats> {
  const db = await getDatabase();
  const [matchRows, registrationRows] = await Promise.all([
    loadMatchRows(db, [teamId]),
    loadRegistrationRows(db, [teamId]),
  ]);

  return summarize({
    matches: matchRows.map((row) => toStatsMatch(row, teamId)),
    tournaments: registrationRows.map(toStatsTournament),
  });
}

/** Raccourci quand seul l'agrégat est utile. */
export async function getTeamStats(teamId: number): Promise<DeepStats> {
  return (await getTeamEntityStats(teamId)).stats;
}

/** Une équipe au classement du site, telle que la voient toutes les vues. */
export type TeamRankingRow = {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  /** Barème partagé appliqué à `wins` / `losses`. Jamais recalculé ailleurs. */
  points: number;
};

type TeamRankingRowSql = RowDataPacket & {
  team_id: number;
  team_name: string;
  logo_url: string | null;
  wins: number;
  losses: number;
};

export type TeamRankingOptions = {
  /**
   * Inclure les équipes n'ayant encore joué aucun match, à 0 point (annuaire,
   * leaderboard). Par défaut, seules les équipes classées sont retournées.
   */
  includeUnplayed?: boolean;
  /**
   * Ne retenir que les matchs terminés il y a **plus de N jours** — sert à
   * reconstituer le classement d'il y a une semaine pour la tendance du
   * leaderboard.
   *
   * Un nombre de jours, et non une date calculée côté application : les
   * `updated_at` sont écrits par la base, la borne doit donc se lire sur la
   * même horloge (`DATE_SUB(NOW(), …)`). Une date construite en JavaScript est
   * mise en forme dans le fuseau du process Node — app en UTC, base en heure de
   * Paris, et la fenêtre se décale sans que rien ne le signale.
   */
  completedMoreThanDaysAgo?: number;
};

/**
 * **Le** classement du site : une ligne par équipe, triée par le barème partagé
 * (`lib/shared/ranking.ts`) appliqué à l'assiette partagée (`playedMatchSql` —
 * byes et matchs fantômes exclus).
 *
 * Toutes les vues qui affichent des « points d'équipe » passent par ici :
 * l'annuaire `/equipes`, la place au classement de la fiche, le leaderboard de
 * la landing. Chacune avait sa propre requête, et donc son propre nombre — le
 * pire étant l'annuaire, dont les victoires étaient multipliées par l'effectif
 * de l'équipe (produit cartésien avec la jointure des membres) avant d'être
 * comptées 3 points la victoire et **+1 la défaite**.
 *
 * Les points sont posés en TypeScript par `rankingPoints`, pas relus d'une
 * colonne SQL : la refonte du barème (base 500 + force de l'adversaire) n'aura
 * qu'un point de calcul à remplacer.
 */
export async function loadTeamRanking(options: TeamRankingOptions = {}): Promise<TeamRankingRow[]> {
  const db = await getDatabase();
  const join = options.includeUnplayed ? "LEFT JOIN" : "JOIN";
  const days = options.completedMoreThanDaysAgo;
  // La valeur part en paramètre lié, mais un entier positif est aussi la seule
  // fenêtre qui ait un sens : autant refuser tout de suite.
  if (days !== undefined && (!Number.isInteger(days) || days < 0)) {
    throw new Error("INVALID_RANKING_WINDOW");
  }
  const before =
    days === undefined ? "" : `\n      AND m.updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)`;
  const [rows] = await db.execute<TeamRankingRowSql[]>(
    `SELECT
      t.id AS team_id,
      t.name AS team_name,
      t.logo_url,
      ${rankingWinsSql("t.id")} AS wins,
      ${rankingLossesSql("t.id")} AS losses
     FROM bg_teams t
     ${join} bg_matches m
       ON ${rankingMatchJoinSql("t.id")}${before}
     WHERE t.solo_user_id IS NULL
     GROUP BY t.id, t.name, t.logo_url`,
    days === undefined ? [] : [days],
  );

  return rows
    .map((row) => {
      const wins = Number(row.wins ?? 0);
      const losses = Number(row.losses ?? 0);
      return {
        teamId: Number(row.team_id),
        teamName: row.team_name,
        logoUrl: row.logo_url,
        wins,
        losses,
        points: rankingPoints(wins, losses),
      };
    })
    .sort((a, b) =>
      compareRankedTeams(
        { points: a.points, wins: a.wins, name: a.teamName },
        { points: b.points, wins: b.wins, name: b.teamName },
      ),
    );
}

/**
 * Place de l'équipe au classement du site, lue dans `loadTeamRanking` — le
 * total de points affiché sur la fiche et la place posée juste à côté sortent
 * donc du même calcul, sur la même assiette que le bilan des matchs.
 *
 * Une équipe sans match n'est pas classée : `total` compte les équipes ayant
 * réellement joué, là où le leaderboard de la landing part de **toutes** les
 * équipes (une équipe sans match y figure à 0 point). Les deux vues n'ont pas
 * le même dénominateur, mais bien le même nombre de points par équipe.
 */
export async function getTeamRankingPosition(teamId: number): Promise<TeamRankingPosition> {
  const scored = await loadTeamRanking();
  const self = scored.find((row) => row.teamId === teamId);

  if (!self) return { position: null, total: scored.length, points: 0 };

  const ahead = scored.filter((row) => row.points > self.points).length;
  return { position: ahead + 1, total: scored.length, points: self.points };
}

/**
 * Périodes d'appartenance d'un joueur, agrégées par équipe. Plusieurs passages
 * dans la même équipe donnent plusieurs fenêtres, toutes conservées.
 */
async function loadMemberships(
  db: Awaited<ReturnType<typeof getDatabase>>,
  userId: number,
): Promise<Membership[]> {
  const [rows] = await db.execute<MembershipRow[]>(
    // L'entrée solo du joueur (tournois individuels, voir
    // `docs/features/SOLO_TOURNAMENTS.md`) compte comme une appartenance
    // ouverte : il « est » cet engagé depuis sa création et ne le quitte
    // jamais. Sans elle, un tournoi joué en individuel disparaîtrait du
    // palmarès et du bilan du joueur.
    `SELECT team_id, joined_at, left_at
     FROM bg_team_members
     WHERE user_id = ?
     UNION ALL
     SELECT id AS team_id, created_at AS joined_at, NULL AS left_at
     FROM bg_teams
     WHERE solo_user_id = ?`,
    [userId, userId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    joinedAt: timestamp(row.joined_at) ?? 0,
    leftAt: timestamp(row.left_at),
  }));
}

/** Période de déroulement d'un tournoi. `end === null` = encore en cours. */
type Span = { start: number; end: number | null };

/**
 * Vrai si l'appartenance du joueur à `teamId` **chevauche** le déroulement du
 * tournoi. Le test porte sur un intervalle, pas sur un instant : un joueur
 * arrivé en cours de tournoi compte, alors qu'un tournoi entièrement terminé
 * avant son arrivée ne lui est pas attribué.
 *
 * Un tournoi non terminé n'a pas de borne de fin : tout membre encore présent
 * y participe.
 */
function membershipOverlaps(memberships: Membership[], teamId: number, span: Span): boolean {
  return memberships.some(
    (membership) =>
      membership.teamId === teamId
      && (span.end === null || membership.joinedAt <= span.end)
      && (membership.leftAt === null || membership.leftAt >= span.start),
  );
}

/**
 * Statistiques approfondies d'un joueur et son historique de tournois, cumulés
 * sur ses équipes successives.
 */
export async function getPlayerEntityStats(userId: number): Promise<EntityStats> {
  const db = await getDatabase();
  const memberships = await loadMemberships(db, userId);
  const teamIds = [...new Set(memberships.map((membership) => membership.teamId))];
  if (teamIds.length === 0) return { stats: emptyDeepStats(), tournaments: [] };

  const [matchRows, registrationRows] = await Promise.all([
    loadMatchRows(db, teamIds),
    loadRegistrationRows(db, teamIds),
  ]);

  // Le crédit se décide **par tournoi**, jamais match par match : un joueur est
  // crédité d'une campagne entière ou d'aucune de ses rencontres.
  const spans = new Map<number, Span>();
  const credited = new Set<string>();
  const tournaments = new Map<number, StatsTournament>();

  for (const row of registrationRows) {
    const tournamentId = Number(row.tournament_id);
    const span: Span = {
      start: timestamp(row.start_at) ?? timestamp(row.played_at) ?? 0,
      end: timestamp(row.finished_at),
    };
    spans.set(tournamentId, span);

    if (!membershipOverlaps(memberships, Number(row.team_id), span)) continue;
    credited.add(`${Number(row.team_id)}:${tournamentId}`);

    // Deux équipes du joueur peuvent avoir disputé le même tournoi : on retient
    // la meilleure place obtenue, pour un palmarès et non une addition.
    const entry = toStatsTournament(row);
    const existing = tournaments.get(tournamentId);
    if (
      !existing
      || (entry.finalRank !== null
        && (existing.finalRank === null || entry.finalRank < existing.finalRank))
    ) {
      tournaments.set(tournamentId, entry);
    }
  }

  const matches: StatsMatch[] = [];
  for (const row of matchRows) {
    const tournamentId = Number(row.tournament_id);
    // Un match peut opposer deux équipes du joueur : on ne le compte qu'une
    // fois, du côté de la première créditée — sans quoi il ajouterait à la fois
    // une victoire et une défaite.
    const side = [Number(row.team1_id), Number(row.team2_id)].find((id) => {
      if (!teamIds.includes(id)) return false;
      if (credited.has(`${id}:${tournamentId}`)) return true;
      // Match sans ligne d'inscription correspondante : on se rabat sur sa
      // propre date plutôt que d'écarter silencieusement la rencontre.
      if (spans.has(tournamentId)) return false;
      const at = timestamp(row.played_at) ?? 0;
      return membershipOverlaps(memberships, id, { start: at, end: at });
    });
    if (side === undefined) continue;
    matches.push(toStatsMatch(row, side));
  }

  return summarize({ matches, tournaments: [...tournaments.values()] });
}

/** Raccourci quand seul l'agrégat est utile. */
export async function getPlayerStats(userId: number): Promise<DeepStats> {
  return (await getPlayerEntityStats(userId)).stats;
}
