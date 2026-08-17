import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  compareStanding,
  computeFinalRanks,
  planSurvivalRound,
  rankActiveTeams,
  replaySurvival,
  samePairings,
  type SurvivalCutSchedule,
  type SurvivalForfeit,
  type SurvivalMatchOutcome,
  type SurvivalStanding,
} from "@/lib/shared/survival";
import { rankingPointsSql } from "@/lib/shared/ranking";
import { createMatch, finishTournament } from "./repository";

const DEFAULT_ROUNDS_PER_CUT = 3;

/**
 * Cadence effective d'un tournoi. `survival_rounds_before_first_cut` est NULL sur
 * les tournois créés avant l'option : la première coupe tombe alors au bout d'un
 * intervalle standard, soit exactement le comportement historique.
 */
function resolveCutSchedule(tournament: TournamentSurvivalRow): SurvivalCutSchedule {
  const roundsPerCut = Number(tournament.survival_rounds_per_cut ?? DEFAULT_ROUNDS_PER_CUT);
  return {
    roundsPerCut,
    roundsBeforeFirstCut: Number(tournament.survival_rounds_before_first_cut ?? roundsPerCut),
    barrageRounds: Number(tournament.survival_barrage_rounds ?? 0),
  };
}

interface TournamentSurvivalRow extends RowDataPacket {
  format: string;
  state: string;
  survival_rounds_before_first_cut: number | null;
  survival_rounds_per_cut: number | null;
  survival_current_round: number;
  survival_barrage_rounds: number;
}

interface StandingDbRow extends RowDataPacket {
  team_id: number;
  seed: number;
  wins: number;
  losses: number;
  status: "ACTIVE" | "ELIMINATED" | "FORFEIT";
  eliminated_round: number | null;
  has_bye: number;
}

async function loadTournament(
  conn: PoolConnection,
  tournamentId: number,
  forUpdate = false,
): Promise<TournamentSurvivalRow | null> {
  const [rows] = await conn.execute<TournamentSurvivalRow[]>(
    `SELECT format, state, survival_rounds_before_first_cut, survival_rounds_per_cut,
            survival_current_round, survival_barrage_rounds
     FROM bg_tournaments WHERE id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tournamentId],
  );
  return rows.length === 0 ? null : rows[0];
}

async function loadStandings(
  conn: PoolConnection,
  tournamentId: number,
): Promise<SurvivalStanding[]> {
  const [rows] = await conn.execute<StandingDbRow[]>(
    `SELECT
      s.team_id,
      s.seed,
      s.wins,
      s.losses,
      s.status,
      s.eliminated_round,
      EXISTS(
        SELECT 1 FROM bg_matches m
        WHERE m.tournament_id = s.tournament_id
          AND m.is_bye = 1
          AND m.winner_team_id = s.team_id
      ) AS has_bye
     FROM bg_survival_standings s
     WHERE s.tournament_id = ?`,
    [tournamentId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    seed: Number(row.seed),
    wins: Number(row.wins),
    losses: Number(row.losses),
    status: row.status,
    eliminatedRound: row.eliminated_round === null ? null : Number(row.eliminated_round),
    hasBye: Number(row.has_bye) === 1,
  }));
}

/** Résultats de tous les matchs du tournoi, dans la forme attendue par le rejeu. */
async function loadMatchOutcomes(
  conn: PoolConnection,
  tournamentId: number,
): Promise<SurvivalMatchOutcome[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      round_number: number;
      status: string;
      winner_team_id: number | null;
      loser_team_id: number | null;
      is_bye: number;
    })[]
  >(
    `SELECT round_number, status, winner_team_id, loser_team_id, is_bye
     FROM bg_matches
     WHERE tournament_id = ?
     ORDER BY round_number, match_number`,
    [tournamentId],
  );

  return rows.map((row) => ({
    round: Number(row.round_number),
    completed: row.status === "COMPLETED",
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    isBye: Number(row.is_bye) === 1,
  }));
}

/**
 * Rejoue le tournoi depuis l'historique des matchs et écrit l'état obtenu.
 *
 * Les abandons sont relus depuis la base : ce sont des décisions humaines, seule
 * partie de l'état qui ne se déduit pas des résultats. Tout le reste (victoires,
 * défaites, éliminations, rangs) est recalculé, de sorte qu'une correction de
 * score se répercute sur les coupes déjà appliquées.
 */
async function replayAndPersist(
  conn: PoolConnection,
  tournamentId: number,
  options: SurvivalCutSchedule & { lastRound: number },
): Promise<SurvivalStanding[]> {
  const stored = await loadStandings(conn, tournamentId);
  if (stored.length === 0) return [];

  const forfeits: SurvivalForfeit[] = stored
    .filter((s) => s.status === "FORFEIT")
    .map((s) => ({ teamId: s.teamId, round: s.eliminatedRound ?? 1 }));

  const derived = replaySurvival({
    teams: stored.map((s) => ({ teamId: s.teamId, seed: s.seed })),
    matches: await loadMatchOutcomes(conn, tournamentId),
    forfeits,
    roundsBeforeFirstCut: options.roundsBeforeFirstCut,
    roundsPerCut: options.roundsPerCut,
    barrageRounds: options.barrageRounds ?? 0,
    lastRound: options.lastRound,
  });

  await persistStandings(conn, tournamentId, derived);
  return derived;
}

/** Construit un `CASE team_id WHEN … THEN …` et alimente le tableau de paramètres. */
function caseExpression<T>(
  standings: SurvivalStanding[],
  params: unknown[],
  value: (s: SurvivalStanding) => T,
): string {
  const branches = standings
    .map((s) => {
      params.push(s.teamId, value(s));
      return "WHEN ? THEN ?";
    })
    .join(" ");
  return `CASE team_id ${branches} END`;
}

/**
 * Écrit victoires, défaites, statut, round d'élimination et rang — en **une**
 * requête. La boucle précédente émettait un `UPDATE` par équipe à chaque score
 * reporté, soit des centaines d'allers-retours sur un gros tournoi.
 */
async function persistStandings(
  conn: PoolConnection,
  tournamentId: number,
  standings: SurvivalStanding[],
): Promise<void> {
  if (standings.length === 0) return;

  const ranks = computeFinalRanks(standings);
  const params: unknown[] = [];
  const wins = caseExpression(standings, params, (s) => s.wins);
  const losses = caseExpression(standings, params, (s) => s.losses);
  const status = caseExpression(standings, params, (s) => s.status);
  const eliminatedRound = caseExpression(standings, params, (s) => s.eliminatedRound);
  const rank = caseExpression(standings, params, (s) => ranks.get(s.teamId) ?? 0);

  const teamIds = standings.map((s) => s.teamId);
  params.push(tournamentId, ...teamIds);

  await conn.execute(
    `UPDATE bg_survival_standings SET
       wins = ${wins},
       losses = ${losses},
       status = ${status},
       eliminated_round = ${eliminatedRound},
       \`rank\` = ${rank}
     WHERE tournament_id = ? AND team_id IN (${teamIds.map(() => "?").join(", ")})`,
    params,
  );
}

/**
 * Initialise le mode Survie : seed depuis le classement du site, création des
 * lignes de standings. Ne démarre aucun round (voir {@link generateSurvivalRound}).
 */
export async function initializeSurvivalTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "SURVIVAL") return;

  // Seed par le classement du site, au **même barème** que le leaderboard de la
  // landing (`lib/shared/ranking.ts`) : les deux formules avaient divergé, et
  // celle du seeding faisait monter une équipe à chaque défaite encaissée.
  const WINS = "COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0)";
  const LOSSES = "COALESCE(SUM(CASE WHEN m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0)";
  const [seedRows] = await conn.execute<
    (RowDataPacket & { team_id: number; wins: number; losses: number })[]
  >(
    `SELECT
      r.team_id,
      ${WINS} AS wins,
      ${LOSSES} AS losses
     FROM bg_tournament_registrations r
     LEFT JOIN bg_matches m
       ON (m.team1_id = r.team_id OR m.team2_id = r.team_id)
      AND m.status = 'COMPLETED'
     WHERE r.tournament_id = ?
     GROUP BY r.team_id
     ORDER BY ${rankingPointsSql(WINS, LOSSES)} DESC, ${WINS} DESC, r.team_id ASC`,
    [tournamentId],
  );

  let seed = 1;
  for (const row of seedRows) {
    await conn.execute(
      `INSERT INTO bg_survival_standings
        (tournament_id, team_id, seed, wins, losses, status, eliminated_round, \`rank\`)
       VALUES (?, ?, ?, 0, 0, 'ACTIVE', NULL, ?)
       ON DUPLICATE KEY UPDATE seed = VALUES(seed), wins = 0, losses = 0,
        status = 'ACTIVE', eliminated_round = NULL, \`rank\` = VALUES(\`rank\`)`,
      [tournamentId, Number(row.team_id), seed, seed],
    );
    seed += 1;
  }

  // Défauts de sécurité si les paramètres n'ont pas été fournis à la création.
  if (tournament.survival_rounds_per_cut === null) {
    await conn.execute(
      `UPDATE bg_tournaments SET survival_rounds_per_cut = ? WHERE id = ?`,
      [DEFAULT_ROUNDS_PER_CUT, tournamentId],
    );
  }
  if (tournament.survival_rounds_before_first_cut === null) {
    await conn.execute(
      `UPDATE bg_tournaments SET survival_rounds_before_first_cut = ? WHERE id = ?`,
      [Number(tournament.survival_rounds_per_cut ?? DEFAULT_ROUNDS_PER_CUT), tournamentId],
    );
  }

  // bracket_size sert de témoin « initialisé » (évite les re-syncs inutiles).
  await conn.execute(
    `UPDATE bg_tournaments SET bracket_size = ?, survival_barrage_rounds = 0 WHERE id = ?`,
    [seedRows.length, tournamentId],
  );
}

/**
 * Génère le round suivant : classe les équipes actives, les apparie par paires
 * adjacentes et crée les matchs. Ne fait rien s'il reste moins de deux équipes
 * actives.
 *
 * Cas impair : au **premier round**, un barrage d'équilibrage oppose les deux
 * dernières du seeding (un seul match, perdant éliminé) ; ensuite — parité
 * cassée par un forfait — l'équipe impaire reçoit une victoire d'office.
 */
export async function generateSurvivalRound(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "SURVIVAL") return;

  const standings = await loadStandings(conn, tournamentId);
  const active = rankActiveTeams(standings);
  if (active.length < 2) return;

  const nextRound = Number(tournament.survival_current_round) + 1;
  const plan = planSurvivalRound(active, { allowBarrage: nextRound === 1 });
  const isBarrage = plan.isBarrage;

  await writeRound(conn, tournamentId, nextRound, plan);

  await conn.execute(
    `UPDATE bg_tournaments
     SET survival_current_round = ?, survival_barrage_rounds = ?
     WHERE id = ?`,
    [nextRound, isBarrage ? 1 : Number(tournament.survival_barrage_rounds ?? 0), tournamentId],
  );
}

/** Applique le classement final et clôt le tournoi. */
async function finalizeSurvival(
  tournamentId: number,
  conn: PoolConnection,
  standings: SurvivalStanding[],
): Promise<void> {
  if (standings.length > 0) {
    const ranks = computeFinalRanks(standings);
    const params: unknown[] = [];
    const rank = caseExpression(standings, params, (s) => ranks.get(s.teamId) ?? 0);
    const teamIds = standings.map((s) => s.teamId);
    params.push(tournamentId, ...teamIds);

    await conn.execute(
      `UPDATE bg_tournament_registrations SET final_rank = ${rank}
       WHERE tournament_id = ? AND team_id IN (${teamIds.map(() => "?").join(", ")})`,
      params,
    );
    await persistStandings(conn, tournamentId, standings);
  }
  await finishTournament(conn, tournamentId);
}

/**
 * Le round `round` porte-t-il déjà une saisie ? Un round généré mais non entamé
 * peut être réapparié sans rien détruire ; dès qu'un score y a été saisi, il est
 * figé (les byes, posés par le moteur, ne comptent pas comme une saisie).
 */
async function roundHasScoreInput(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  const [rows] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND round_number = ? AND is_bye = 0
       AND (team1_score IS NOT NULL OR team2_score IS NOT NULL
            OR winner_team_id IS NOT NULL OR forfeit_team_id IS NOT NULL
            OR team1_reported_at IS NOT NULL OR team2_reported_at IS NOT NULL)`,
    [tournamentId, round],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

/** Crée les matchs d'un round à partir d'un plan d'appariement. */
async function writeRound(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  plan: ReturnType<typeof planSurvivalRound>,
): Promise<void> {
  let matchNumber = 1;
  for (const pairing of plan.pairings) {
    const matchId = await createMatch(conn, tournamentId, "UPPER", round, matchNumber);
    await conn.execute(
      `UPDATE bg_matches SET team1_id = ?, team2_id = ?, status = 'READY', is_bye = 0
       WHERE id = ?`,
      [pairing.teamAId, pairing.teamBId, matchId],
    );
    matchNumber += 1;
  }

  if (plan.byeTeamId !== null) {
    const matchId = await createMatch(conn, tournamentId, "UPPER", round, matchNumber);
    await conn.execute(
      `UPDATE bg_matches SET
        team1_id = ?, team2_id = NULL, is_bye = 1, status = 'COMPLETED',
        team1_score = 1, team2_score = 0, winner_team_id = ?
       WHERE id = ?`,
      [plan.byeTeamId, plan.byeTeamId, matchId],
    );
  }
}

/** Lit les appariements déjà en base pour un round, sous forme de plan. */
async function readRoundPlan(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<ReturnType<typeof planSurvivalRound> | null> {
  const [rows] = await conn.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null; is_bye: number })[]
  >(
    `SELECT team1_id, team2_id, is_bye FROM bg_matches
     WHERE tournament_id = ? AND round_number = ?
     ORDER BY match_number`,
    [tournamentId, round],
  );
  if (rows.length === 0) return null;

  const pairings = rows
    .filter((r) => Number(r.is_bye) === 0 && r.team1_id !== null && r.team2_id !== null)
    .map((r) => ({ teamAId: Number(r.team1_id), teamBId: Number(r.team2_id) }));
  const byeRow = rows.find((r) => Number(r.is_bye) === 1);

  return {
    pairings,
    byeTeamId: byeRow?.team1_id === undefined || byeRow.team1_id === null ? null : Number(byeRow.team1_id),
    isBarrage: false,
  };
}

/**
 * Garantit que le round suivant colle au classement courant : il est créé s'il
 * n'existe pas, et **réapparié** si une correction de score en amont a changé le
 * classement — tant qu'aucun score n'y a été saisi. Sans cela, les paires
 * restaient celles calculées avant correction.
 */
async function ensureNextRound(
  conn: PoolConnection,
  tournamentId: number,
  nextRound: number,
  active: SurvivalStanding[],
): Promise<boolean> {
  const desired = planSurvivalRound(active, { allowBarrage: nextRound === 1 });
  const existing = await readRoundPlan(conn, tournamentId, nextRound);

  if (existing === null) {
    await writeRound(conn, tournamentId, nextRound, desired);
    return true;
  }

  if (samePairings(existing, desired)) return false;
  if (await roundHasScoreInput(conn, tournamentId, nextRound)) return false;

  await conn.execute(`DELETE FROM bg_matches WHERE tournament_id = ? AND round_number = ?`, [
    tournamentId,
    nextRound,
  ]);
  await writeRound(conn, tournamentId, nextRound, desired);
  return true;
}

/**
 * Réconcilie l'état du tournoi Survie après tout changement de score.
 * Idempotent : recalcule les stats, applique la coupe due, puis clôt ou génère
 * le round suivant. Sûr à appeler quel que soit le chemin (report, admin, bye).
 */
export async function reconcileSurvival(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  // Verrou de ligne : sérialise les réconciliations concurrentes (deux reports
  // simultanés clôturant le même round) pour éviter de générer deux fois le
  // round suivant ou d'appliquer deux fois une coupe.
  const tournament = await loadTournament(conn, tournamentId, true);
  if (!tournament || tournament.format !== "SURVIVAL") return;
  if (tournament.state === "FINISHED") return;

  const schedule = resolveCutSchedule(tournament);
  const currentRound = Number(tournament.survival_current_round);

  // Tout l'état (victoires, défaites, éliminations, rangs) est redérivé de
  // l'historique des matchs : une correction de score en amont défait la coupe
  // qu'elle avait provoquée au lieu de la laisser figée.
  const standings = await replayAndPersist(conn, tournamentId, {
    ...schedule,
    lastRound: currentRound,
  });

  // Aucun round généré (départ avec 0 ou 1 équipe) : clôture immédiate.
  if (currentRound === 0) {
    if (rankActiveTeams(standings).length <= 1) {
      await finalizeSurvival(tournamentId, conn, standings);
    }
    return;
  }

  const active = rankActiveTeams(standings);

  // Round encore en cours ?
  const [incomplete] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND round_number = ? AND status <> 'COMPLETED'`,
    [tournamentId, currentRound],
  );

  if (Number(incomplete[0]?.c ?? 0) > 0) {
    // Le round courant n'a peut-être jamais été entamé : si une correction de
    // score en amont a changé le classement, ses appariements sont périmés.
    if (active.length >= 2) {
      await ensureNextRound(conn, tournamentId, currentRound, active);
    }
    return;
  }

  if (active.length <= 1) {
    await finalizeSurvival(tournamentId, conn, standings);
    return;
  }

  // Round suivant : créé s'il manque, réapparié s'il ne colle plus au classement.
  const changed = await ensureNextRound(conn, tournamentId, currentRound + 1, active);
  if (changed) {
    await conn.execute(
      `UPDATE bg_tournaments SET survival_current_round = ? WHERE id = ? AND survival_current_round < ?`,
      [currentRound + 1, tournamentId, currentRound + 1],
    );
    // Un round entièrement composé de byes doit enchaîner immédiatement.
    await reconcileSurvival(tournamentId, conn);
  }
}

/**
 * Déclare le forfait d'une équipe : elle quitte le tournoi. Son match en cours
 * (le cas échéant) est résolu en faveur de l'adversaire, puis l'état est
 * réconcilié (coupe/clôture/round suivant).
 */
export async function forfeitSurvivalTeam(
  tournamentId: number,
  teamId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId, true);
  if (!tournament || tournament.format !== "SURVIVAL") throw new Error("NOT_SURVIVAL");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

  const [standingRows] = await conn.execute<StandingDbRow[]>(
    `SELECT status FROM bg_survival_standings WHERE tournament_id = ? AND team_id = ? LIMIT 1`,
    [tournamentId, teamId],
  );
  if (standingRows.length === 0) throw new Error("TEAM_NOT_IN_TOURNAMENT");
  if (standingRows[0].status !== "ACTIVE") throw new Error("TEAM_ALREADY_OUT");

  const currentRound = Number(tournament.survival_current_round);

  // Résout le match non terminé du round courant impliquant l'équipe : victoire
  // par forfait pour l'adversaire (ou match fantôme si c'était un bye).
  const [matchRows] = await conn.execute<
    (RowDataPacket & { id: number; team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT id, team1_id, team2_id FROM bg_matches
     WHERE tournament_id = ? AND round_number = ? AND status <> 'COMPLETED'
       AND (team1_id = ? OR team2_id = ?)
     LIMIT 1`,
    [tournamentId, currentRound, teamId, teamId],
  );

  if (matchRows.length > 0) {
    const match = matchRows[0];
    const opponentId =
      Number(match.team1_id) === teamId ? match.team2_id : match.team1_id;
    if (opponentId !== null) {
      const team1IsForfeit = Number(match.team1_id) === teamId;
      await conn.execute(
        `UPDATE bg_matches SET
          status = 'COMPLETED',
          winner_team_id = ?,
          loser_team_id = ?,
          forfeit_team_id = ?,
          team1_score = ?,
          team2_score = ?,
          team1_report_score = NULL, team1_report_opponent_score = NULL, team1_reported_at = NULL,
          team2_report_score = NULL, team2_report_opponent_score = NULL, team2_reported_at = NULL,
          score_deadline_at = NULL
         WHERE id = ?`,
        [
          Number(opponentId),
          teamId,
          teamId,
          team1IsForfeit ? 0 : 1,
          team1IsForfeit ? 1 : 0,
          match.id,
        ],
      );
    }
  }

  await conn.execute(
    `UPDATE bg_survival_standings
     SET status = 'FORFEIT', eliminated_round = ?
     WHERE tournament_id = ? AND team_id = ?`,
    [Math.max(currentRound, 1), tournamentId, teamId],
  );

  await reconcileSurvival(tournamentId, conn);
}

/**
 * Charge les métadonnées Survie pour l'affichage (round courant, cadence de
 * coupe, classement complet avec noms d'équipes). Renvoie null hors mode Survie.
 */
export async function loadSurvivalMeta(
  conn: PoolConnection,
  tournamentId: number,
): Promise<import("@/lib/shared/types").SurvivalMeta | null> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "SURVIVAL") return null;

  const [rows] = await conn.execute<
    (StandingDbRow & { team_name: string; logo_url: string | null; rank: number })[]
  >(
    `SELECT
      s.team_id, s.seed, s.wins, s.losses, s.status, s.eliminated_round, s.\`rank\`,
      t.name AS team_name, t.logo_url
     FROM bg_survival_standings s
     JOIN bg_teams t ON t.id = s.team_id
     WHERE s.tournament_id = ?
     ORDER BY s.\`rank\` ASC, s.seed ASC`,
    [tournamentId],
  );

  const schedule = resolveCutSchedule(tournament);

  return {
    roundsBeforeFirstCut: schedule.roundsBeforeFirstCut,
    roundsPerCut: schedule.roundsPerCut,
    currentRound: Number(tournament.survival_current_round),
    barrageRounds: Number(tournament.survival_barrage_rounds ?? 0),
    standings: rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      logoUrl: row.logo_url,
      seed: Number(row.seed),
      wins: Number(row.wins),
      losses: Number(row.losses),
      status: row.status,
      eliminatedRound: row.eliminated_round === null ? null : Number(row.eliminated_round),
      rank: Number(row.rank),
    })),
  };
}

export { compareStanding };
