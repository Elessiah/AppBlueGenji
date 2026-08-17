import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  DEFAULT_SWISS_POINTS,
  DEFAULT_SWISS_TIEBREAKERS,
  activeStandings,
  computeRecommendedRounds,
  isSwissComplete,
  rankSwiss,
  replaySwiss,
  type SwissForfeit,
  type SwissMatchOutcome,
  type SwissPointsConfig,
  type SwissRankedStanding,
  type SwissStanding,
} from "@/lib/shared/swiss";
import {
  planFirstRound,
  planNextRound,
  samePlan,
  type Participant,
  type SwissRoundPlan,
} from "@/lib/shared/swiss-pairing";
import { rankingPointsSql } from "@/lib/shared/ranking";
import type { SwissMeta, SwissTiebreaker } from "@/lib/shared/types";
import { createMatch, finishTournament } from "./repository";

interface TournamentSwissRow extends RowDataPacket {
  format: string;
  state: string;
  swiss_total_rounds: number | null;
  swiss_current_round: number;
  swiss_points_win: number;
  swiss_points_draw: number;
  swiss_points_loss: number;
  swiss_points_bye: number;
  swiss_tiebreakers_json: string | SwissTiebreaker[] | null;
}

interface StandingDbRow extends RowDataPacket {
  team_id: number;
  seed: number;
  status: "ACTIVE" | "FORFEIT";
  forfeit_round: number | null;
}

async function loadTournament(
  conn: PoolConnection,
  tournamentId: number,
  forUpdate = false,
): Promise<TournamentSwissRow | null> {
  const [rows] = await conn.execute<TournamentSwissRow[]>(
    `SELECT format, state, swiss_total_rounds, swiss_current_round,
            swiss_points_win, swiss_points_draw, swiss_points_loss, swiss_points_bye,
            swiss_tiebreakers_json
     FROM bg_tournaments WHERE id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tournamentId],
  );
  return rows.length === 0 ? null : rows[0];
}

function resolvePoints(tournament: TournamentSwissRow): SwissPointsConfig {
  return {
    win: Number(tournament.swiss_points_win ?? DEFAULT_SWISS_POINTS.win),
    draw: Number(tournament.swiss_points_draw ?? DEFAULT_SWISS_POINTS.draw),
    loss: Number(tournament.swiss_points_loss ?? DEFAULT_SWISS_POINTS.loss),
    bye: Number(tournament.swiss_points_bye ?? DEFAULT_SWISS_POINTS.bye),
  };
}

/**
 * `swiss_tiebreakers_json` est une colonne JSON : mysql2 la renvoie déjà
 * désérialisée (tableau), mais un dump SQL ou un driver alternatif peut la
 * rendre sous forme de chaîne. On accepte les deux plutôt que de faire un
 * `JSON.parse` aveugle, qui échouerait sur le tableau.
 */
export function parseTiebreakers(
  value: string | SwissTiebreaker[] | null,
): SwissTiebreaker[] {
  const raw: unknown =
    typeof value === "string" && value.length > 0
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        })()
      : value;

  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_SWISS_TIEBREAKERS;
  const allowed = new Set<string>(DEFAULT_SWISS_TIEBREAKERS);
  const kept = raw.filter((v): v is SwissTiebreaker => typeof v === "string" && allowed.has(v));
  return kept.length === 0 ? DEFAULT_SWISS_TIEBREAKERS : kept;
}

/** Seeds et abandons : la seule part de l'état qui ne se déduit pas des matchs. */
async function loadSeeds(
  conn: PoolConnection,
  tournamentId: number,
): Promise<StandingDbRow[]> {
  const [rows] = await conn.execute<StandingDbRow[]>(
    `SELECT team_id, seed, status, forfeit_round
     FROM bg_swiss_standings WHERE tournament_id = ? ORDER BY seed ASC`,
    [tournamentId],
  );
  return rows;
}

/** Résultats de tous les matchs du tournoi, dans la forme attendue par le rejeu. */
async function loadMatchOutcomes(
  conn: PoolConnection,
  tournamentId: number,
): Promise<SwissMatchOutcome[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      round_number: number;
      status: string;
      team1_id: number | null;
      team2_id: number | null;
      winner_team_id: number | null;
      loser_team_id: number | null;
      is_bye: number;
    })[]
  >(
    `SELECT round_number, status, team1_id, team2_id, winner_team_id, loser_team_id, is_bye
     FROM bg_matches
     WHERE tournament_id = ?
     ORDER BY round_number, match_number`,
    [tournamentId],
  );

  return rows.map((row) => ({
    round: Number(row.round_number),
    completed: row.status === "COMPLETED",
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    isBye: Number(row.is_bye) === 1,
  }));
}

type SwissState = {
  /** État courant, tous matchs confondus : sert au classement et à l'affichage. */
  standings: SwissStanding[];
  matches: SwissMatchOutcome[];
  /**
   * État tel qu'il était **avant** la ronde donnée, pour l'apparier.
   *
   * Apparier la ronde R à partir de l'état courant serait circulaire : les
   * matchs déjà programmés en R feraient partie de l'historique des rencontres,
   * et le moteur refuserait de reformer les paires qu'il vient de créer. Il
   * réappariait alors la ronde à chaque réconciliation, indéfiniment.
   */
  before: (round: number) => SwissStanding[];
};

/** État complet redérivé de l'historique, prêt à être classé, apparié ou persisté. */
async function deriveState(
  conn: PoolConnection,
  tournamentId: number,
  tournament: TournamentSwissRow,
): Promise<SwissState> {
  const seeds = await loadSeeds(conn, tournamentId);
  if (seeds.length === 0) {
    return { standings: [], matches: [], before: () => [] };
  }

  const forfeits: SwissForfeit[] = seeds
    .filter((row) => row.status === "FORFEIT")
    .map((row) => ({ teamId: Number(row.team_id), round: Number(row.forfeit_round ?? 1) }));

  const matches = await loadMatchOutcomes(conn, tournamentId);
  const teams = seeds.map((row) => ({ teamId: Number(row.team_id), seed: Number(row.seed) }));
  const points = resolvePoints(tournament);

  const replay = (subset: SwissMatchOutcome[]): SwissStanding[] =>
    replaySwiss({ teams, matches: subset, forfeits, points });

  return {
    standings: replay(matches),
    matches,
    before: (round) => replay(matches.filter((m) => m.round < round)),
  };
}

/** Construit un `CASE team_id WHEN … THEN …` et alimente le tableau de paramètres. */
function caseExpression<T>(
  standings: SwissRankedStanding[],
  params: unknown[],
  value: (s: SwissRankedStanding) => T,
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
 * Écrit points, bilan, adversaires, Buchholz et rang — en **une** requête plutôt
 * qu'un `UPDATE` par équipe, qui coûtait des centaines d'allers-retours sur un
 * gros tournoi à chaque score reporté.
 */
async function persistStandings(
  conn: PoolConnection,
  tournamentId: number,
  ranked: SwissRankedStanding[],
): Promise<void> {
  if (ranked.length === 0) return;

  const params: unknown[] = [];
  const points = caseExpression(ranked, params, (s) => s.points);
  const wins = caseExpression(ranked, params, (s) => s.wins);
  const draws = caseExpression(ranked, params, (s) => s.draws);
  const losses = caseExpression(ranked, params, (s) => s.losses);
  const byes = caseExpression(ranked, params, (s) => s.byes);
  const opponents = caseExpression(ranked, params, (s) => JSON.stringify(s.opponentIds));
  const buchholz = caseExpression(ranked, params, (s) => s.buchholz);
  const rank = caseExpression(ranked, params, (s) => s.rank);

  const teamIds = ranked.map((s) => s.teamId);
  params.push(tournamentId, ...teamIds);

  await conn.execute(
    `UPDATE bg_swiss_standings SET
       points = ${points},
       wins = ${wins},
       draws = ${draws},
       losses = ${losses},
       byes = ${byes},
       opponent_ids_json = ${opponents},
       buchholz = ${buchholz},
       \`rank\` = ${rank}
     WHERE tournament_id = ? AND team_id IN (${teamIds.map(() => "?").join(", ")})`,
    params,
  );
}

/**
 * Initialise le mode Suisse : seed depuis le classement du site, création des
 * lignes de standings, calcul du nombre de rondes si l'organisateur ne l'a pas
 * fixé. Ne démarre aucune ronde (voir {@link generateSwissRound}).
 */
export async function initializeSwissTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "SWISS") return;

  // Seed par le classement du site, au **même barème** que le leaderboard de la
  // landing (`lib/shared/ranking.ts`) et que le mode Survie : la ronde 1 oppose
  // la moitié haute à la moitié basse, encore faut-il que « haute » veuille dire
  // quelque chose.
  const WINS = "COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0)";
  const LOSSES = "COALESCE(SUM(CASE WHEN m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0)";
  const [seedRows] = await conn.execute<(RowDataPacket & { team_id: number })[]>(
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
      `INSERT INTO bg_swiss_standings
        (tournament_id, team_id, seed, points, wins, draws, losses, byes,
         opponent_ids_json, buchholz, \`rank\`, status, forfeit_round)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, '[]', 0, ?, 'ACTIVE', NULL)
       ON DUPLICATE KEY UPDATE seed = VALUES(seed), points = 0, wins = 0, draws = 0,
        losses = 0, byes = 0, opponent_ids_json = '[]', buchholz = 0,
        \`rank\` = VALUES(\`rank\`), status = 'ACTIVE', forfeit_round = NULL`,
      [tournamentId, Number(row.team_id), seed, seed],
    );
    seed += 1;
  }

  // Nombre de rondes : recommandation ⌈log₂(N)⌉ + 1 si rien n'a été fixé.
  if (tournament.swiss_total_rounds === null) {
    await conn.execute(`UPDATE bg_tournaments SET swiss_total_rounds = ? WHERE id = ?`, [
      computeRecommendedRounds(seedRows.length),
      tournamentId,
    ]);
  }

  // bracket_size sert de témoin « initialisé » (évite les re-syncs inutiles).
  await conn.execute(`UPDATE bg_tournaments SET bracket_size = ? WHERE id = ?`, [
    seedRows.length,
    tournamentId,
  ]);
}

/** Vue « appariement » d'une équipe, telle qu'attendue par le moteur de tirage. */
function toParticipants(standings: SwissStanding[]): Participant[] {
  return activeStandings(standings).map((s) => ({
    teamId: s.teamId,
    points: s.points,
    opponentIds: s.opponentIds,
    hasReceivedBye: s.byes > 0,
    seed: s.seed,
  }));
}

/** Crée les matchs d'une ronde à partir d'un plan d'appariement. */
async function writeRound(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  plan: SwissRoundPlan,
): Promise<void> {
  let matchNumber = 1;
  for (const pairing of plan.pairings) {
    const matchId = await createMatch(conn, tournamentId, "UPPER", round, matchNumber);
    await conn.execute(
      `UPDATE bg_matches SET team1_id = ?, team2_id = ?, swiss_round = ?, status = 'READY', is_bye = 0
       WHERE id = ?`,
      [pairing.teamAId, pairing.teamBId, round, matchId],
    );
    matchNumber += 1;
  }

  if (plan.byeTeamId !== null) {
    const matchId = await createMatch(conn, tournamentId, "UPPER", round, matchNumber);
    // `team1_score` est un score de **match** (cartes gagnées), pas un total de
    // points : on écrit 1-0 comme en Survie. Les points du bye viennent du rejeu
    // (`points.bye`), jamais de cette colonne — y stocker le barème afficherait
    // un « 10 – 0 » sur un tournoi réglé à 10 points la victoire.
    await conn.execute(
      `UPDATE bg_matches SET
        team1_id = ?, team2_id = NULL, swiss_round = ?, is_bye = 1, status = 'COMPLETED',
        team1_score = 1, team2_score = 0, winner_team_id = ?
       WHERE id = ?`,
      [plan.byeTeamId, round, plan.byeTeamId, matchId],
    );
  }
}

/** Lit les appariements déjà en base pour une ronde, sous forme de plan. */
async function readRoundPlan(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<SwissRoundPlan | null> {
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
    byeTeamId:
      byeRow === undefined || byeRow.team1_id === null ? null : Number(byeRow.team1_id),
  };
}

/**
 * La ronde `round` porte-t-elle déjà une saisie ? Une ronde générée mais non
 * entamée peut être réappariée sans rien détruire ; dès qu'un score y a été
 * saisi, elle est figée (les byes, posés par le moteur, ne comptent pas).
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

/**
 * Garantit que la ronde donnée colle au classement courant : elle est créée si
 * elle n'existe pas, et **réappariée** si une correction de score en amont a
 * changé le classement — tant qu'aucun score n'y a été saisi. Sans cela, les
 * paires resteraient celles calculées avant correction.
 */
async function ensureRound(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  state: SwissState,
): Promise<boolean> {
  const participants = toParticipants(state.before(round));
  const desired = round === 1 ? planFirstRound(participants) : planNextRound(participants);
  const existing = await readRoundPlan(conn, tournamentId, round);

  if (existing === null) {
    await writeRound(conn, tournamentId, round, desired);
    return true;
  }

  if (samePlan(existing, desired)) return false;
  if (await roundHasScoreInput(conn, tournamentId, round)) return false;

  await conn.execute(`DELETE FROM bg_matches WHERE tournament_id = ? AND round_number = ?`, [
    tournamentId,
    round,
  ]);
  await writeRound(conn, tournamentId, round, desired);
  return true;
}

/** Génère la première ronde (appelée au passage du tournoi en RUNNING). */
export async function generateSwissRound(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "SWISS") return;
  if (Number(tournament.swiss_current_round) > 0) return;

  const state = await deriveState(conn, tournamentId, tournament);
  if (activeStandings(state.standings).length < 2) return;

  await ensureRound(conn, tournamentId, 1, state);
  await conn.execute(`UPDATE bg_tournaments SET swiss_current_round = 1 WHERE id = ?`, [
    tournamentId,
  ]);
}

/** Applique le classement final aux inscriptions et clôt le tournoi. */
async function finalizeSwiss(
  tournamentId: number,
  conn: PoolConnection,
  ranked: SwissRankedStanding[],
): Promise<void> {
  if (ranked.length > 0) {
    const params: unknown[] = [];
    const rank = caseExpression(ranked, params, (s) => s.rank);
    const teamIds = ranked.map((s) => s.teamId);
    params.push(tournamentId, ...teamIds);

    await conn.execute(
      `UPDATE bg_tournament_registrations SET final_rank = ${rank}
       WHERE tournament_id = ? AND team_id IN (${teamIds.map(() => "?").join(", ")})`,
      params,
    );
    await persistStandings(conn, tournamentId, ranked);
  }
  await finishTournament(conn, tournamentId);
}

/**
 * Réconcilie l'état du tournoi Suisse après tout changement de score.
 *
 * Idempotent : recalcule le classement depuis l'historique, réapparie la ronde
 * suivante si le classement a bougé, puis clôt le tournoi une fois toutes les
 * rondes jouées. Sûr à appeler quel que soit le chemin (report d'équipe,
 * arbitrage, bye, forfait).
 */
export async function reconcileSwiss(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  // Verrou de ligne : sérialise les réconciliations concurrentes (deux reports
  // simultanés clôturant la même ronde) pour éviter de générer deux fois la
  // ronde suivante.
  const tournament = await loadTournament(conn, tournamentId, true);
  if (!tournament || tournament.format !== "SWISS") return;
  if (tournament.state === "FINISHED") return;

  const tiebreakers = parseTiebreakers(tournament.swiss_tiebreakers_json);
  const currentRound = Number(tournament.swiss_current_round);
  const totalRounds = Number(tournament.swiss_total_rounds ?? 0);

  const state = await deriveState(conn, tournamentId, tournament);
  if (state.standings.length === 0) return;

  const ranked = rankSwiss(state.standings, state.matches, tiebreakers);
  await persistStandings(conn, tournamentId, ranked);

  const active = activeStandings(state.standings);

  // Aucune ronde générée (départ à 0 ou 1 équipe) : clôture immédiate.
  if (currentRound === 0) {
    if (active.length <= 1) await finalizeSwiss(tournamentId, conn, ranked);
    return;
  }

  const [incomplete] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND round_number = ? AND status <> 'COMPLETED'`,
    [tournamentId, currentRound],
  );

  if (Number(incomplete[0]?.c ?? 0) > 0) {
    // La ronde courante n'a peut-être jamais été entamée : si une correction en
    // amont a changé le classement, ses appariements sont périmés.
    if (active.length >= 2) {
      await ensureRound(conn, tournamentId, currentRound, state);
    }
    return;
  }

  // Toutes les rondes prévues sont jouées : le classement fait foi.
  if (isSwissComplete(currentRound, totalRounds) || active.length <= 1) {
    await finalizeSwiss(tournamentId, conn, ranked);
    return;
  }

  const changed = await ensureRound(conn, tournamentId, currentRound + 1, state);
  if (changed) {
    await conn.execute(
      `UPDATE bg_tournaments SET swiss_current_round = ? WHERE id = ? AND swiss_current_round < ?`,
      [currentRound + 1, tournamentId, currentRound + 1],
    );
    // Une ronde entièrement composée de byes doit enchaîner immédiatement.
    await reconcileSwiss(tournamentId, conn);
  }
}

/**
 * Déclare le forfait d'une équipe : elle quitte le tournoi et n'est plus
 * appariée. Son match en cours est résolu en faveur de l'adversaire, puis l'état
 * est réconcilié.
 */
export async function forfeitSwissTeam(
  tournamentId: number,
  teamId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId, true);
  if (!tournament || tournament.format !== "SWISS") throw new Error("NOT_SWISS");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

  const [standingRows] = await conn.execute<StandingDbRow[]>(
    `SELECT status FROM bg_swiss_standings WHERE tournament_id = ? AND team_id = ? LIMIT 1`,
    [tournamentId, teamId],
  );
  if (standingRows.length === 0) throw new Error("TEAM_NOT_IN_TOURNAMENT");
  if (standingRows[0].status !== "ACTIVE") throw new Error("TEAM_ALREADY_OUT");

  const currentRound = Number(tournament.swiss_current_round);

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
    const opponentId = Number(match.team1_id) === teamId ? match.team2_id : match.team1_id;
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
    `UPDATE bg_swiss_standings SET status = 'FORFEIT', forfeit_round = ?
     WHERE tournament_id = ? AND team_id = ?`,
    [Math.max(currentRound, 1), tournamentId, teamId],
  );

  await reconcileSwiss(tournamentId, conn);
}

/**
 * Charge les métadonnées Suisse pour l'affichage (ronde courante, barème,
 * classement complet avec noms d'équipes). Renvoie null hors mode Suisse.
 */
export async function loadSwissMeta(
  conn: PoolConnection,
  tournamentId: number,
): Promise<SwissMeta | null> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "SWISS") return null;

  const [rows] = await conn.execute<
    (RowDataPacket & {
      team_id: number;
      team_name: string;
      logo_url: string | null;
      seed: number;
      points: number;
      wins: number;
      draws: number;
      losses: number;
      byes: number;
      buchholz: string | number;
      rank: number;
      status: "ACTIVE" | "FORFEIT";
    })[]
  >(
    `SELECT
      s.team_id, s.seed, s.points, s.wins, s.draws, s.losses, s.byes,
      s.buchholz, s.\`rank\`, s.status,
      t.name AS team_name, t.logo_url
     FROM bg_swiss_standings s
     JOIN bg_teams t ON t.id = s.team_id
     WHERE s.tournament_id = ?
     ORDER BY s.\`rank\` ASC, s.seed ASC`,
    [tournamentId],
  );

  const points = resolvePoints(tournament);

  return {
    totalRounds: Number(tournament.swiss_total_rounds ?? 0),
    currentRound: Number(tournament.swiss_current_round),
    pointsForWin: points.win,
    pointsForDraw: points.draw,
    pointsForLoss: points.loss,
    pointsForBye: points.bye,
    tiebreakers: parseTiebreakers(tournament.swiss_tiebreakers_json),
    standings: rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      logoUrl: row.logo_url,
      seed: Number(row.seed),
      points: Number(row.points),
      wins: Number(row.wins),
      draws: Number(row.draws),
      losses: Number(row.losses),
      byes: Number(row.byes),
      buchholz: Number(row.buchholz),
      status: row.status,
      rank: Number(row.rank),
    })),
  };
}
