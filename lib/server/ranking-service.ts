/**
 * **Le** chargeur du classement du site.
 *
 * Toutes les vues qui affichent des « points d'équipe » ou qui seedent sur le
 * classement passent par ici : l'annuaire `/equipes`, la place au classement de
 * la fiche, le leaderboard de la landing, et le seeding de la Survie, de la
 * Ronde suisse, du Multi-phases et de l'aperçu du plateau.
 *
 * Le module ne calcule rien : il **collecte** les rencontres comptées
 * (`playedMatchSql` — byes et matchs fantômes exclus) et délègue le rejeu à
 * `replayRanking` (`lib/shared/ranking.ts`, pur et testable sans base).
 *
 * ## Pourquoi le SQL ne peut plus rendre les points
 *
 * Une cote de type Elo dépend de **l'ordre** des rencontres : les points qu'un
 * match transfère se lisent sur les cotes des deux équipes à cet instant-là. Un
 * `SUM()` ne peut donc plus produire le total, et les quatre requêtes de
 * seeding qui triaient sur une expression SQL ne le peuvent pas davantage :
 * elles lisent maintenant l'état rejoué, comme les autres vues.
 *
 * Rien n'est stocké pour autant — c'est la propriété que le projet tient partout
 * (`replaySurvival`, `replaySwiss`) : le classement est une **fonction pure** des
 * matchs comptés, de leurs vainqueurs et de leurs dates. Une correction de score
 * s'y répercute seule, et rien ne reste accroché à un total accumulé.
 *
 * ## Coût
 *
 * Le rejeu lit tous les matchs terminés du site. C'est une lecture séquentielle
 * bornée, mutualisée par `ranking-cache.ts` (vol unique, invalidation à chaque
 * écriture de score) : cent lecteurs simultanés coûtent un rejeu.
 */

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { cachedRanking } from "./ranking-cache";
import {
  baseRankedTeamState,
  compareRankedTeams,
  PLAYED_MATCH_SQL,
  RANKING_BASE_POINTS,
  replayRanking,
  type RankedMatch,
  type RankedTeamState,
} from "@/lib/shared/ranking";
import type { TeamRankingPosition } from "@/lib/shared/stats";

export type { TeamRankingPosition };

/** Tout ce dont ce module a besoin d'une source de données : pool ou connexion. */
type Queryable = Pick<Pool | PoolConnection, "execute">;

/** Une équipe au classement du site, telle que la voient toutes les vues. */
export type TeamRankingRow = {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  /** Cote rejouée. Jamais recalculée ailleurs. */
  points: number;
};

export type TeamRankingOptions = {
  /**
   * Inclure les équipes n'ayant encore joué aucun match, à la cote de départ
   * (annuaire, leaderboard). Par défaut, seules les équipes classées sont
   * retournées.
   *
   * Elles ne peuvent pas pour autant se glisser au milieu du tableau :
   * `compareRankedTeams` range toute équipe sans match **après** les classées,
   * quelle que soit sa cote.
   */
  includeUnplayed?: boolean;
  /**
   * Ne rejouer que les matchs terminés il y a **plus de N jours** — sert à
   * reconstituer le classement d'il y a une semaine pour la tendance du
   * leaderboard. Le rejeu s'arrête simplement plus tôt.
   *
   * Un nombre de jours, et non une date calculée côté application : les
   * `updated_at` sont écrits par la base, la borne doit donc se lire sur la
   * même horloge (`DATE_SUB(NOW(), …)`). Une date construite en JavaScript est
   * mise en forme dans le fuseau du process Node — app en UTC, base en heure de
   * Paris, et la fenêtre se décale sans que rien ne le signale.
   */
  completedMoreThanDaysAgo?: number;
  /**
   * Lire sur une connexion précise plutôt que sur le pool.
   *
   * Le seeding s'exécute **dans la transaction** qui lance le tournoi : il doit
   * lire là où sa transaction voit ce qu'elle a écrit.
   */
  connection?: Queryable;
  /**
   * Accepter la photo mutualisée du classement (`ranking-cache`) plutôt que de
   * rejouer pour soi.
   *
   * C'est le réglage des **lectures** : elles n'ont aucune raison de rejouer
   * tout `bg_matches` par consultation, et le cache leur sert d'ailleurs
   * exactement le nombre que l'annuaire et le leaderboard affichent au même
   * moment. Par défaut, une lecture sur le pool est donc mutualisée.
   *
   * Le seeding, lui, doit poser `false` : dans la transaction qui lance le
   * tournoi, une photo prise avant elle n'est pas ce qu'elle voit.
   */
  shared?: boolean;
};

type RankedMatchRow = RowDataPacket & {
  id: number;
  team1_id: number;
  team2_id: number;
  winner_team_id: number;
  played_at: Date | string | null;
};

type TeamIdentityRow = RowDataPacket & {
  id: number;
  name: string;
  logo_url: string | null;
};

function validateWindow(days: number | undefined): void {
  // La valeur part en paramètre lié, mais un entier positif est aussi la seule
  // fenêtre qui ait un sens : autant refuser tout de suite.
  if (days !== undefined && (!Number.isInteger(days) || days < 0)) {
    throw new Error("INVALID_RANKING_WINDOW");
  }
}

function isoOrEpoch(value: Date | string | null): string {
  if (value === null) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

/**
 * Rencontres comptées du site, prêtes pour le rejeu.
 *
 * La chronologie est celle des fiches et des barres de forme
 * (`COALESCE(m.updated_at, t.finished_at, t.start_at)`) : une seule lecture de
 * « quand ce match a-t-il eu lieu », donc pas deux histoires du site. Le tri
 * final reste posé par `replayRanking`, à qui la règle appartient — l'`ORDER BY`
 * n'est qu'une commodité.
 */
async function loadRankedMatches(
  db: Queryable,
  days: number | undefined,
): Promise<RankedMatch[]> {
  const before =
    days === undefined ? "" : `\n       AND m.updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)`;
  const [rows] = await db.execute<RankedMatchRow[]>(
    `SELECT
      m.id,
      m.team1_id,
      m.team2_id,
      m.winner_team_id,
      COALESCE(m.updated_at, t.finished_at, t.start_at) AS played_at
     FROM bg_matches m
     JOIN bg_tournaments t ON t.id = m.tournament_id
     WHERE ${PLAYED_MATCH_SQL}${before}
     ORDER BY played_at ASC, m.id ASC`,
    days === undefined ? [] : [days],
  );

  return rows.map((row) => {
    const team1 = Number(row.team1_id);
    const team2 = Number(row.team2_id);
    const winner = Number(row.winner_team_id);
    return {
      matchId: Number(row.id),
      winnerTeamId: winner,
      loserTeamId: winner === team1 ? team2 : team1,
      playedAt: isoOrEpoch(row.played_at),
    };
  });
}

/**
 * État rejoué du classement : une cote par équipe ayant disputé un match
 * compté.
 *
 * **Toutes** les engagées sont rejouées, entrées solo et équipes fantômes
 * comprises : leur cote est celle de l'adversaire dans les matchs des autres, on
 * ne peut donc pas la sauter sans fausser le calcul de ceux qui les affrontent.
 * Ce qu'on filtre, c'est l'**affichage** (voir `loadTeamRanking`) et non le
 * rejeu.
 */
export async function loadRankingState(
  options: Pick<TeamRankingOptions, "completedMoreThanDaysAgo" | "connection" | "shared"> = {},
): Promise<Map<number, RankedTeamState>> {
  const days = options.completedMoreThanDaysAgo;
  validateWindow(days);

  // Une connexion donnée reste la source de données ; ce que `shared` décide,
  // c'est seulement si l'on a le droit de resservir une photo déjà prise. Les
  // deux sont indépendants : l'aperçu du plateau lit sur sa connexion **et**
  // accepte le cache, le seeding lit sur la sienne et le refuse.
  const replay = async () => {
    const db = options.connection ?? (await getDatabase());
    return replayRanking(await loadRankedMatches(db, days));
  };

  // Sans connexion, on lit pour afficher : mutualisé par défaut.
  const shared = options.shared ?? options.connection === undefined;
  if (!shared) return replay();

  return cachedRanking(`state:${days ?? "all"}`, replay);
}

/**
 * **Le** classement du site : une ligne par équipe, triée par
 * `compareRankedTeams`.
 *
 * Les entrées solo (`solo_user_id`) sont écartées de la liste : ce sont des
 * engagés de tournoi individuel, pas des équipes — les laisser décalerait le
 * rang de toutes les autres. Les équipes fantômes, elles, restent : ce sont des
 * équipes du site, administrées par le staff, et elles jouent contre les
 * autres.
 */
export async function loadTeamRanking(options: TeamRankingOptions = {}): Promise<TeamRankingRow[]> {
  const db = options.connection ?? (await getDatabase());
  const states = await loadRankingState(options);

  const [teams] = await db.execute<TeamIdentityRow[]>(
    `SELECT id, name, logo_url
     FROM bg_teams
     WHERE solo_user_id IS NULL`,
  );

  const rows: TeamRankingRow[] = [];
  for (const team of teams) {
    const teamId = Number(team.id);
    const state = states.get(teamId) ?? baseRankedTeamState();
    if (!options.includeUnplayed && state.matchesPlayed === 0) continue;
    rows.push({
      teamId,
      teamName: team.name,
      logoUrl: team.logo_url,
      wins: state.wins,
      losses: state.losses,
      points: state.points,
    });
  }

  return rows.sort((a, b) =>
    compareRankedTeams(
      { points: a.points, wins: a.wins, losses: a.losses, name: a.teamName },
      { points: b.points, wins: b.wins, losses: b.losses, name: b.teamName },
    ),
  );
}

/** Une engagée dans l'ordre du classement du site. */
export type RankedEntrant = {
  teamId: number;
  teamName: string;
};

type EntrantRow = RowDataPacket & { team_id: number; team_name: string };

/**
 * Inscrites d'un tournoi, **dans l'ordre du classement du site**.
 *
 * Seule porte du seeding par classement : Survie, Ronde suisse, Multi-phases et
 * l'aperçu du plateau l'appellent tous, si bien qu'un aperçu ne peut pas
 * diverger du tirage réel, ni deux formats se seeder différemment.
 *
 * Les quatre requêtes qu'elle remplace triaient sur une expression SQL
 * (`points DESC, wins DESC, team_id ASC`) : une cote rejouée ne s'écrit pas en
 * SQL, et l'ordre passe donc par `compareRankedTeams` — la règle de tri unique,
 * celle-là même qu'appliquent l'annuaire et le leaderboard.
 *
 * Tout se lit sur la connexion de l'appelant. Ce que `transactional` décide,
 * c'est seulement si le classement peut venir d'une photo déjà prise
 * (`ranking-cache`) :
 *
 * - `true` (défaut) — le seeding : il s'exécute dans la transaction qui lance le
 *   tournoi et doit voir le classement tel que cette transaction le voit, donc
 *   sans photo antérieure ;
 * - `false` — l'aperçu du plateau : une **lecture seule**, hors transaction, où
 *   rejouer tout `bg_matches` par consultation coûterait sans rien garantir de
 *   plus. Le cache y sert d'ailleurs la même donnée que l'annuaire et le
 *   leaderboard affichent au même moment.
 */
export async function loadEntrantsBySiteRanking(
  connection: Queryable,
  tournamentId: number,
  options: { transactional?: boolean } = {},
): Promise<RankedEntrant[]> {
  const states = await loadRankingState({
    connection,
    shared: options.transactional === false,
  });

  const [rows] = await connection.execute<EntrantRow[]>(
    `SELECT r.team_id, t.name AS team_name
     FROM bg_tournament_registrations r
     JOIN bg_teams t ON t.id = r.team_id
     WHERE r.tournament_id = ?`,
    [tournamentId],
  );

  return rows
    .map((row) => {
      const teamId = Number(row.team_id);
      const state = states.get(teamId) ?? baseRankedTeamState();
      return {
        teamId,
        teamName: row.team_name,
        points: state.points,
        wins: state.wins,
        losses: state.losses,
      };
    })
    .sort((a, b) =>
      compareRankedTeams(
        { points: a.points, wins: a.wins, losses: a.losses, name: a.teamName },
        { points: b.points, wins: b.wins, losses: b.losses, name: b.teamName },
      ),
    )
    .map(({ teamId, teamName }) => ({ teamId, teamName }));
}

/**
 * Place de l'équipe au classement du site, lue dans `loadTeamRanking` — la cote
 * affichée sur la fiche et la place posée juste à côté sortent donc du même
 * calcul, sur la même assiette que le bilan des matchs.
 *
 * Une équipe sans match n'est pas classée : `total` compte les équipes ayant
 * réellement joué, là où le leaderboard de la landing part de **toutes** les
 * équipes (une équipe sans match y figure à la cote de départ, rangée après les
 * classées). Les deux vues n'ont pas le même dénominateur, mais bien la même
 * cote par équipe.
 */
export async function getTeamRankingPosition(teamId: number): Promise<TeamRankingPosition> {
  const scored = await loadTeamRanking();
  const self = scored.find((row) => row.teamId === teamId);

  if (!self) return { position: null, total: scored.length, points: RANKING_BASE_POINTS };

  const ahead = scored.filter((row) => row.points > self.points).length;
  return { position: ahead + 1, total: scored.length, points: self.points };
}
