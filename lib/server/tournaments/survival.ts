import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  compareStanding,
  computeFinalRanks,
  isCutRound,
  planSurvivalRound,
  rankActiveTeams,
  selectEliminatedTeamIds,
  teamsToEliminate,
  type SurvivalStanding,
} from "@/lib/shared/survival";
import { createMatch, finishTournament } from "./repository";

const DEFAULT_ROUNDS_PER_CUT = 3;

interface TournamentSurvivalRow extends RowDataPacket {
  format: string;
  state: string;
  survival_rounds_per_cut: number | null;
  survival_current_round: number;
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
    `SELECT format, state, survival_rounds_per_cut, survival_current_round
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

/**
 * Recalcule victoires/défaites de chaque équipe à partir des matchs terminés.
 * Idempotent : dérive tout des matchs, jamais d'accumulation d'écarts.
 */
async function recomputeWinsLosses(conn: PoolConnection, tournamentId: number): Promise<void> {
  await conn.execute(
    `UPDATE bg_survival_standings s
     SET
       wins = (
         SELECT COUNT(*) FROM bg_matches m
         WHERE m.tournament_id = s.tournament_id AND m.winner_team_id = s.team_id
       ),
       losses = (
         SELECT COUNT(*) FROM bg_matches m
         WHERE m.tournament_id = s.tournament_id AND m.loser_team_id = s.team_id
       )
     WHERE s.tournament_id = ?`,
    [tournamentId],
  );
}

/** Met à jour le rang persisté de chaque équipe (actives en tête, puis éliminées). */
async function updateRanks(
  conn: PoolConnection,
  tournamentId: number,
  standings: SurvivalStanding[],
): Promise<void> {
  const ranks = computeFinalRanks(standings);
  for (const [teamId, rank] of ranks) {
    await conn.execute(
      `UPDATE bg_survival_standings SET \`rank\` = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, teamId],
    );
  }
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

  // Seed par le classement du site : points = victoires×3 + défaites×1 sur
  // l'ensemble des matchs terminés, toutes compétitions confondues.
  const [seedRows] = await conn.execute<
    (RowDataPacket & { team_id: number; wins: number; losses: number })[]
  >(
    `SELECT
      r.team_id,
      COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.status = 'COMPLETED' AND m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS losses
     FROM bg_tournament_registrations r
     LEFT JOIN bg_matches m
       ON (m.team1_id = r.team_id OR m.team2_id = r.team_id)
     WHERE r.tournament_id = ?
     GROUP BY r.team_id
     ORDER BY (COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0) * 3
             + COALESCE(SUM(CASE WHEN m.status = 'COMPLETED' AND m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0)) DESC,
              r.team_id ASC`,
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

  // Défaut de sécurité si le paramètre n'a pas été fourni à la création.
  if (tournament.survival_rounds_per_cut === null) {
    await conn.execute(
      `UPDATE bg_tournaments SET survival_rounds_per_cut = ? WHERE id = ?`,
      [DEFAULT_ROUNDS_PER_CUT, tournamentId],
    );
  }

  // bracket_size sert de témoin « initialisé » (évite les re-syncs inutiles).
  await conn.execute(`UPDATE bg_tournaments SET bracket_size = ? WHERE id = ?`, [
    seedRows.length,
    tournamentId,
  ]);
}

/**
 * Génère le round suivant : classe les équipes actives, les apparie par paires
 * adjacentes et crée les matchs. L'éventuelle équipe impaire reçoit une victoire
 * d'office (bye). Ne fait rien s'il reste moins de deux équipes actives.
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
  const { pairings, byeTeamId } = planSurvivalRound(active);

  let matchNumber = 1;
  for (const pairing of pairings) {
    const matchId = await createMatch(conn, tournamentId, "UPPER", nextRound, matchNumber);
    await conn.execute(
      `UPDATE bg_matches SET team1_id = ?, team2_id = ?, status = 'READY', is_bye = 0
       WHERE id = ?`,
      [pairing.teamAId, pairing.teamBId, matchId],
    );
    matchNumber += 1;
  }

  if (byeTeamId !== null) {
    const matchId = await createMatch(conn, tournamentId, "UPPER", nextRound, matchNumber);
    await conn.execute(
      `UPDATE bg_matches SET
        team1_id = ?, team2_id = NULL, is_bye = 1, status = 'COMPLETED',
        team1_score = 1, team2_score = 0, winner_team_id = ?
       WHERE id = ?`,
      [byeTeamId, byeTeamId, matchId],
    );
  }

  await conn.execute(`UPDATE bg_tournaments SET survival_current_round = ? WHERE id = ?`, [
    nextRound,
    tournamentId,
  ]);
}

/** Applique le classement final et clôt le tournoi. */
async function finalizeSurvival(
  tournamentId: number,
  conn: PoolConnection,
  standings: SurvivalStanding[],
): Promise<void> {
  const ranks = computeFinalRanks(standings);
  for (const [teamId, rank] of ranks) {
    await conn.execute(
      `UPDATE bg_tournament_registrations SET final_rank = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, teamId],
    );
    await conn.execute(
      `UPDATE bg_survival_standings SET \`rank\` = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, teamId],
    );
  }
  await finishTournament(conn, tournamentId);
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

  await recomputeWinsLosses(conn, tournamentId);

  const roundsPerCut = Number(tournament.survival_rounds_per_cut ?? DEFAULT_ROUNDS_PER_CUT);
  const currentRound = Number(tournament.survival_current_round);

  let standings = await loadStandings(conn, tournamentId);
  await updateRanks(conn, tournamentId, standings);

  // Aucun round généré (départ avec 0 ou 1 équipe) : clôture immédiate.
  if (currentRound === 0) {
    if (rankActiveTeams(standings).length <= 1) {
      await finalizeSurvival(tournamentId, conn, standings);
    }
    return;
  }

  // Round encore en cours ?
  const [incomplete] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND round_number = ? AND status <> 'COMPLETED'`,
    [tournamentId, currentRound],
  );
  if (Number(incomplete[0]?.c ?? 0) > 0) return;

  // Coupe due à la fin de ce round ? (pas déjà appliquée)
  const alreadyCut = standings.some(
    (s) => s.status === "ELIMINATED" && s.eliminatedRound === currentRound,
  );
  if (isCutRound(currentRound, roundsPerCut) && !alreadyCut) {
    const active = rankActiveTeams(standings);
    const toEliminate = selectEliminatedTeamIds(active, teamsToEliminate(active.length));
    for (const teamId of toEliminate) {
      await conn.execute(
        `UPDATE bg_survival_standings
         SET status = 'ELIMINATED', eliminated_round = ?
         WHERE tournament_id = ? AND team_id = ?`,
        [currentRound, tournamentId, teamId],
      );
    }
    standings = await loadStandings(conn, tournamentId);
    await updateRanks(conn, tournamentId, standings);
  }

  const active = rankActiveTeams(standings);
  if (active.length <= 1) {
    await finalizeSurvival(tournamentId, conn, standings);
    return;
  }

  // Génère le round suivant si ce n'est pas déjà fait.
  const [nextExists] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND round_number = ?`,
    [tournamentId, currentRound + 1],
  );
  if (Number(nextExists[0]?.c ?? 0) === 0) {
    await generateSurvivalRound(tournamentId, conn);
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

  return {
    roundsPerCut: Number(tournament.survival_rounds_per_cut ?? DEFAULT_ROUNDS_PER_CUT),
    currentRound: Number(tournament.survival_current_round),
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
