/**
 * Orchestration du mode « BlueGenji Survie » (voir `docs/features/BG_SURVIE_MODE.md`).
 *
 * Découpage identique à la Survie et à la Ronde suisse : la logique est pure
 * (`lib/shared/bg-survie.ts`), ce module ne fait que lire/écrire la base.
 *
 * - `initializeEnduranceTournament` — sème le classement depuis l'ordre de
 *   seeding (défini à la main par l'arbitre) et pose le barème.
 * - `generateEnduranceRound` — apparie et crée les matchs de la manche suivante.
 * - `reconcileEndurance` — **rejoue** tout depuis l'historique, persiste le
 *   classement, enchaîne la manche suivante ou bascule en play-offs.
 * - `startEndurancePlayoffs` — construit l'arbre à 8 selon le tableau imposé.
 * - `applyEndurancePenalty` / `liftEndurancePenalty` — sanction d'arbitrage sur
 *   le capital d'endurance (`lib/shared/endurance-penalty.ts`). Elles n'écrivent
 *   **que** la table des pénalités, puis laissent le rejeu en tirer les
 *   conséquences : aucune des deux ne touche au classement.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  assignRanks,
  forfeitMapCount,
  pairingsAreStale,
  planEnduranceRound,
  planNextPlayoffRound,
  planPlayoffFirstRound,
  playoffRoundIsStale,
  qualificationComplete,
  rankActiveTeams,
  roundLimitReached,
  replayEndurance,
  replayEnduranceDetailed,
  resolveEnduranceConfig,
  selectQualifiedTeamIds,
  type EnduranceConfig,
  type EnduranceMatchOutcome,
  type EndurancePenalty,
  type EnduranceStanding,
  type EnduranceStatus,
  type PlayoffRoundPlan,
} from "@/lib/shared/bg-survie";
import {
  checkEndurancePenalty,
  normalizePenaltyReason,
} from "@/lib/shared/endurance-penalty";
import { parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { toIso } from "@/lib/server/serialization";
import { createMatch, finishTournament } from "./repository";

type TournamentEnduranceRow = RowDataPacket & {
  format: string;
  state: string;
  match_format_type: string | null;
  match_format_value: number | null;
  endurance_start_points: number | null;
  endurance_win_delta: number | null;
  endurance_loss_delta: number | null;
  endurance_playoff_size: number | null;
  endurance_max_rounds: number | null;
  endurance_current_round: number;
  endurance_playoffs_started: number;
  has_third_place_match: number;
};

async function loadTournament(
  conn: PoolConnection,
  tournamentId: number,
): Promise<TournamentEnduranceRow | null> {
  const [rows] = await conn.execute<TournamentEnduranceRow[]>(
    `SELECT format, state, match_format_type, match_format_value,
            endurance_start_points, endurance_win_delta, endurance_loss_delta,
            endurance_playoff_size, endurance_max_rounds, endurance_current_round,
            endurance_playoffs_started, has_third_place_match
     FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  return rows.length === 0 ? null : rows[0];
}

function configOf(tournament: TournamentEnduranceRow): EnduranceConfig {
  return resolveEnduranceConfig({
    startPoints: tournament.endurance_start_points ?? undefined,
    winDelta: tournament.endurance_win_delta ?? undefined,
    lossDelta: tournament.endurance_loss_delta ?? undefined,
    playoffSize: tournament.endurance_playoff_size ?? undefined,
    maxRounds: tournament.endurance_max_rounds ?? undefined,
  });
}

/**
 * Format de match du tournoi (`null` = score libre). C'est lui qui chiffre un
 * forfait : en FT3, l'équipe partie encaisse un 3-0.
 */
function matchFormatOf(tournament: TournamentEnduranceRow): MatchFormat | null {
  return parseMatchFormat(tournament.match_format_type, tournament.match_format_value);
}

/** Manches de la phase qualificative : bracket UPPER, phase_id 0. */
const QUALIFICATION_BRACKET = "UPPER" as const;

/**
 * Première manche de la phase éliminatoire. Les manches de qualification
 * occupent 1..N ; les play-offs repartent d'un palier élevé pour que les deux
 * phases restent lisibles côte à côte dans l'historique des matchs.
 */
const PLAYOFF_ROUND_OFFSET = 1000;

export async function loadEnduranceStandings(
  conn: PoolConnection,
  tournamentId: number,
): Promise<EnduranceStanding[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      team_id: number;
      seed: number;
      points: number;
      wins: number;
      losses: number;
      status: EnduranceStatus;
      eliminated_round: number | null;
      rank: number;
    })[]
  >(
    `SELECT team_id, seed, points, wins, losses, status, eliminated_round, \`rank\`
     FROM bg_endurance_standings
     WHERE tournament_id = ?
     ORDER BY \`rank\` ASC, seed ASC`,
    [tournamentId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    seed: Number(row.seed),
    points: Number(row.points),
    wins: Number(row.wins),
    losses: Number(row.losses),
    status: row.status,
    eliminatedRound: row.eliminated_round === null ? null : Number(row.eliminated_round),
    rank: Number(row.rank),
    // Le classement stocké est celui de la dernière réconciliation : il fait
    // office d'« ordre précédent » pour les départages à égalité.
    previousRank: Number(row.rank),
  }));
}

async function persistStandings(
  conn: PoolConnection,
  tournamentId: number,
  standings: EnduranceStanding[],
): Promise<void> {
  for (const standing of standings) {
    await conn.execute(
      `INSERT INTO bg_endurance_standings
        (tournament_id, team_id, seed, points, wins, losses, status, eliminated_round, \`rank\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        seed = VALUES(seed), points = VALUES(points), wins = VALUES(wins),
        losses = VALUES(losses), status = VALUES(status),
        eliminated_round = VALUES(eliminated_round), \`rank\` = VALUES(\`rank\`)`,
      [
        tournamentId,
        standing.teamId,
        standing.seed,
        standing.points,
        standing.wins,
        standing.losses,
        standing.status,
        standing.eliminatedRound,
        standing.rank,
      ],
    );
  }
}

/**
 * Sème le classement initial depuis l'**ordre de seeding** des inscriptions —
 * celui que l'arbitre a fixé à la main (`docs/features/SEEDING_ORDER.md`), le
 * règlement demandant un classement de départ décidé en amont.
 */
export async function initializeEnduranceTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") return;

  const config = configOf(tournament);

  const [rows] = await conn.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id
     FROM bg_tournament_registrations
     WHERE tournament_id = ?
     ORDER BY COALESCE(seed, 1000000), registered_at ASC`,
    [tournamentId],
  );

  const standings: EnduranceStanding[] = rows.map((row, index) => ({
    teamId: Number(row.team_id),
    seed: index + 1,
    points: config.startPoints,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: index + 1,
    previousRank: index + 1,
  }));

  await persistStandings(conn, tournamentId, standings);

  // Fige le barème effectif : les valeurs par défaut deviennent explicites,
  // pour que l'affichage et un futur changement de défaut ne modifient pas un
  // tournoi déjà lancé.
  await conn.execute(
    `UPDATE bg_tournaments
     SET endurance_start_points = ?, endurance_win_delta = ?, endurance_loss_delta = ?,
         endurance_playoff_size = ?, endurance_max_rounds = ?,
         endurance_current_round = 0, endurance_playoffs_started = 0,
         bracket_size = ?
     WHERE id = ?`,
    [
      config.startPoints,
      config.winDelta,
      config.lossDelta,
      config.playoffSize,
      config.maxRounds,
      standings.length,
      tournamentId,
    ],
  );
}

/**
 * Crée les matchs de la manche suivante de la phase qualificative.
 *
 * Ne fait rien si la phase est terminée (effectif retombé à la cible), si les
 * play-offs ont commencé, ou s'il reste moins de deux équipes.
 */
export async function generateEnduranceRound(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") return;
  if (Number(tournament.endurance_playoffs_started) === 1) return;

  const config = configOf(tournament);
  const standings = await loadEnduranceStandings(conn, tournamentId);
  const active = rankActiveTeams(standings);

  if (active.length < 2 || qualificationComplete(active.length, config)) return;

  const nextRound = Number(tournament.endurance_current_round) + 1;

  // Plafond de manches : on n'en pose jamais une de plus. Le rejeu a déjà
  // tranché qui est qualifié à la dernière manche — c'est `reconcileEndurance`
  // qui enchaîne sur les play-offs, ici il n'y a plus rien à apparier.
  if (roundLimitReached(config, nextRound - 1)) return;
  const pairings = planEnduranceRound(standings);

  let matchNumber = 1;
  for (const pairing of pairings) {
    // Effectif impair : la dernière ne joue pas et son capital reste intact —
    // aucun match n'est donc créé pour elle (pas de victoire d'office ici).
    if (pairing.teamBId === null) continue;

    const matchId = await createMatch(
      conn,
      tournamentId,
      QUALIFICATION_BRACKET,
      nextRound,
      matchNumber,
      0,
    );
    await conn.execute(
      `UPDATE bg_matches SET team1_id = ?, team2_id = ?, status = 'READY', is_bye = 0 WHERE id = ?`,
      [pairing.teamAId, pairing.teamBId, matchId],
    );
    matchNumber += 1;
  }

  await conn.execute(`UPDATE bg_tournaments SET endurance_current_round = ? WHERE id = ?`, [
    nextRound,
    tournamentId,
  ]);
}

/** Matchs de la phase qualificative, sous forme de résultats rejouables. */
async function loadQualificationOutcomes(
  conn: PoolConnection,
  tournamentId: number,
): Promise<EnduranceMatchOutcome[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      round_number: number;
      status: string;
      team1_id: number | null;
      team2_id: number | null;
      team1_score: number | null;
      team2_score: number | null;
      winner_team_id: number | null;
      loser_team_id: number | null;
      forfeit_team_id: number | null;
    })[]
  >(
    `SELECT round_number, status, team1_id, team2_id, team1_score, team2_score,
            winner_team_id, loser_team_id, forfeit_team_id
     FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number < ?
     ORDER BY round_number ASC, match_number ASC`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );

  return rows.map((row) => {
    const winnerTeamId = row.winner_team_id === null ? null : Number(row.winner_team_id);
    // Les scores sont rangés par side (team1/team2) : les réordonner par
    // vainqueur/perdant est ce qui permet au barème de se compter map par map.
    const winnerIsTeam1 = winnerTeamId !== null && winnerTeamId === Number(row.team1_id);
    const winnerScore = winnerIsTeam1 ? row.team1_score : row.team2_score;
    const loserScore = winnerIsTeam1 ? row.team2_score : row.team1_score;

    return {
      round: Number(row.round_number),
      completed: row.status === "COMPLETED",
      winnerTeamId,
      loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
      winnerMaps: winnerScore === null ? null : Number(winnerScore),
      loserMaps: loserScore === null ? null : Number(loserScore),
      // `!= null` couvre aussi une colonne absente : un forfait doit être une
      // information positive, jamais un défaut.
      isForfeit: row.forfeit_team_id != null,
    };
  });
}

/**
 * Pénalités d'endurance du tournoi, telles qu'elles entrent dans le rejeu.
 *
 * Lues à chaque réconciliation plutôt que cumulées quelque part : le classement
 * est écrasé à chaque entretien, un total qui y vivrait ne survivrait pas au
 * premier score corrigé.
 */
async function loadPenalties(
  conn: PoolConnection,
  tournamentId: number,
): Promise<EndurancePenalty[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & { team_id: number; round_number: number; points: number })[]
  >(
    `SELECT team_id, round_number, points
     FROM bg_endurance_penalties
     WHERE tournament_id = ?
     ORDER BY round_number ASC, id ASC`,
    [tournamentId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    round: Number(row.round_number),
    points: Number(row.points),
  }));
}

/** Abandons déclarés, dérivés du statut FORFEIT déjà stocké. */
async function loadForfeits(
  conn: PoolConnection,
  tournamentId: number,
): Promise<{ teamId: number; round: number }[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & { team_id: number; eliminated_round: number | null })[]
  >(
    `SELECT team_id, eliminated_round
     FROM bg_endurance_standings
     WHERE tournament_id = ? AND status = 'FORFEIT'`,
    [tournamentId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    round: Number(row.eliminated_round ?? 1),
  }));
}

/**
 * Rejoue la phase qualificative, persiste le classement, puis :
 * - enchaîne la manche suivante si la précédente est complète ;
 * - bascule en play-offs dès que l'effectif atteint la cible.
 *
 * Idempotent : appelable après chaque saisie de score.
 */
export async function reconcileEndurance(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") return;
  if (tournament.state === "FINISHED") return;

  const config = configOf(tournament);
  const stored = await loadEnduranceStandings(conn, tournamentId);
  if (stored.length === 0) return;

  const replayed = replayEndurance({
    teams: stored.map((standing) => ({ teamId: standing.teamId, seed: standing.seed })),
    matches: await loadQualificationOutcomes(conn, tournamentId),
    forfeits: await loadForfeits(conn, tournamentId),
    penalties: await loadPenalties(conn, tournamentId),
    config,
    lastRound: Number(tournament.endurance_current_round),
    matchFormat: matchFormatOf(tournament),
  });

  await persistStandings(conn, tournamentId, assignRanks(replayed));

  if (Number(tournament.endurance_playoffs_started) === 1) {
    // L'arbre se relit avant de s'enchaîner : une correction de score en amont
    // (un quart de finale, voire une manche qualificative) a pu périmer un tour
    // déjà posé, et rien d'autre ne le regarde.
    await repairPlayoffBracket(conn, tournamentId, assignRanks(replayed), config);
    await finalizePlayoffsIfDone(conn, tournamentId);
    return;
  }

  const active = replayed.filter((standing) => standing.status === "ACTIVE");
  const currentRound = Number(tournament.endurance_current_round);

  // Une correction de score en amont réécrit le classement : la manche courante,
  // si elle est déjà posée mais pas entamée, décrit alors des appariements
  // périmés (voire une équipe éliminée entre-temps). On la défait pour la
  // reformer depuis le classement rejoué — c'est ce que font déjà la Survie et
  // la Ronde suisse.
  //
  // Une manche défaite n'est pas « une manche en cours » : elle n'a jamais été
  // jouée. On repart donc de la précédente, et la décision qui suit est la même
  // que si l'on venait d'en terminer une. La défaire puis **sortir** laissait le
  // tournoi sans manche et sans arbre dès que la correction achevait la
  // qualification — `generateEnduranceRound` sort alors sur
  // `qualificationComplete` sans rien créer, et plus rien n'aurait repris le
  // tournoi, faute d'un match sur lequel reporter un score.
  let effectiveRound = currentRound;
  if (currentRound > 0 && !(await roundHasScoreInput(conn, tournamentId, currentRound))) {
    if (await roundPairingsAreStale(conn, tournamentId, currentRound, replayed)) {
      await conn.execute(
        `DELETE FROM bg_matches WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?`,
        [tournamentId, currentRound],
      );
      await conn.execute(`UPDATE bg_tournaments SET endurance_current_round = ? WHERE id = ?`, [
        currentRound - 1,
        tournamentId,
      ]);
      effectiveRound = currentRound - 1;
    }
  }

  // Rien ne se décide **au milieu d'une manche**. Un seul score reporté peut
  // faire tomber l'effectif actif sur la cible des play-offs alors que les
  // autres rencontres de la manche sont encore `READY` : bascule immédiate, et
  // ces matchs restaient ouverts à jamais — `reconcileEndurance` repartant
  // ensuite par la branche `playoffsStarted`, plus rien ne les regardait. La
  // manche entière est donc jouée avant qu'on lise son classement, que ce soit
  // pour clore la qualification ou pour apparier la suivante.
  if (!(await roundIsComplete(conn, tournamentId, effectiveRound))) return;

  // Le plafond de manches n'a pas de branche à lui : le rejeu écarte lui-même
  // les non-qualifiées à la dernière manche, si bien que l'effectif retombe à
  // `playoffSize` et que la bascule ci-dessous se déclenche comme d'habitude.
  if (qualificationComplete(active.length, config)) {
    await startEndurancePlayoffs(tournamentId, conn);
    return;
  }

  await generateEnduranceRound(tournamentId, conn);
}

/**
 * « Ce match porte une saisie » — le prédicat de `match-lock` en SQL.
 *
 * Écrit une seule fois : trois lectures s'en servent (réappariement d'une
 * manche périmée, verrou du retrait d'une pénalité, et la borne que l'interface
 * reçoit pour ne pas proposer un geste que le serveur refusera). Trois copies
 * divergeraient au premier réglage, et l'interface offrirait alors un bouton
 * voué au 409.
 */
const HAS_SCORE_INPUT_SQL = `(team1_score IS NOT NULL OR team2_score IS NOT NULL
            OR winner_team_id IS NOT NULL OR forfeit_team_id IS NOT NULL
            OR status = 'AWAITING_CONFIRMATION')`;

/** Un match de la manche porte-t-il déjà une saisie ? */
async function roundHasScoreInput(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  const [rows] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?
       AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, round],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

/**
 * Dernière manche qualificative portant une saisie, `0` s'il n'y en a aucune.
 *
 * C'est la borne du retrait d'une pénalité, telle que l'interface la reçoit :
 * une sanction de la manche N ne se retire plus dès qu'une manche strictement
 * postérieure a été entamée. Une seule requête pour tout le tableau, là où
 * `laterRoundHasScoreInput` en fait une par écriture.
 */
async function lastRoundWithScoreInput(
  conn: PoolConnection,
  tournamentId: number,
): Promise<number> {
  const [rows] = await conn.execute<(RowDataPacket & { last_round: number | null })[]>(
    `SELECT MAX(round_number) AS last_round FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number < ?
       AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );
  return Number(rows[0]?.last_round ?? 0);
}

/**
 * Une manche **postérieure** à `round` porte-t-elle déjà une saisie ?
 *
 * C'est la règle de `lib/shared/match-lock.ts` appliquée aux sanctions : en
 * survie, sans lien de bracket, toute manche ultérieure dépend des
 * précédentes — leurs appariements se recalculent depuis le classement. Une
 * pénalité retirée derrière une manche déjà jouée remettrait donc une équipe
 * en lice sans que les manches qu'elle a manquées soient réappariées : elle
 * rentrerait avec un capital intact devant celles qui ont réellement joué.
 *
 * Le `>` est strict : la manche de la sanction elle-même peut être entamée,
 * la pénalité tombe de toute façon **après** ses matchs.
 */
async function laterRoundHasScoreInput(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  const [rows] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number > ?
       AND round_number < ?
       AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, round, PLAYOFF_ROUND_OFFSET],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

/**
 * Les appariements posés pour cette manche correspondent-ils encore au
 * classement rejoué ? Comparaison sur les couples, l'ordre des sides étant
 * lui aussi dérivé du classement.
 */
async function roundPairingsAreStale(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  standings: EnduranceStanding[],
): Promise<boolean> {
  const [rows] = await conn.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?
     ORDER BY match_number ASC`,
    [tournamentId, round],
  );
  if (rows.length === 0) return false;

  return pairingsAreStale(
    planEnduranceRound(standings).filter((pairing) => pairing.teamBId !== null),
    rows.map((row) => ({
      teamAId: row.team1_id === null ? null : Number(row.team1_id),
      teamBId: row.team2_id === null ? null : Number(row.team2_id),
    })),
  );
}

/** Vrai si tous les matchs de la manche sont terminés (0 match = manche vide). */
async function roundIsComplete(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  if (round <= 0) return true;

  const [rows] = await conn.execute<(RowDataPacket & { total: number; done: number })[]>(
    `SELECT COUNT(*) AS total, SUM(status = 'COMPLETED') AS done
     FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?`,
    [tournamentId, round],
  );

  const total = Number(rows[0]?.total ?? 0);
  const done = Number(rows[0]?.done ?? 0);
  return total > 0 && total === done;
}

/**
 * Construit la phase éliminatoire.
 *
 * À huit qualifiées, le tableau imposé (8v4, 6v2, 1v5, 3v7) est appliqué tel
 * quel. En dessous — tournoi sous-rempli — on retombe sur un appariement
 * classique haut contre bas, faute de tableau défini pour cet effectif. Le
 * tirage lui-même vit dans le module pur (`planPlayoffFirstRound`), partagé avec
 * la réparation de l'arbre : une correction de score ne doit jamais poser un
 * autre tableau que celui qu'un lancement aurait produit.
 */
export async function startEndurancePlayoffs(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") return;
  if (Number(tournament.endurance_playoffs_started) === 1) return;

  const config = configOf(tournament);
  const standings = await loadEnduranceStandings(conn, tournamentId);
  const qualified = selectQualifiedTeamIds(standings, config);

  if (qualified.length <= 1) {
    await finalizeEndurance(conn, tournamentId, standings);
    return;
  }

  await writePlayoffRound(
    conn,
    tournamentId,
    PLAYOFF_ROUND_OFFSET,
    planPlayoffFirstRound(qualified, config),
    [],
  );

  await conn.execute(
    `UPDATE bg_tournaments SET endurance_playoffs_started = 1 WHERE id = ?`,
    [tournamentId],
  );
}

/** Une rencontre d'arbre final telle qu'elle est posée en base. */
type PlayoffMatchRow = {
  id: number;
  bracket: string;
  status: string;
  teamAId: number | null;
  teamBId: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  hasScoreInput: boolean;
};

/** Numéros des tours d'arbre final déjà posés, du premier au dernier. */
async function loadPlayoffRoundNumbers(
  conn: PoolConnection,
  tournamentId: number,
): Promise<number[]> {
  const [rows] = await conn.execute<(RowDataPacket & { round_number: number })[]>(
    `SELECT DISTINCT round_number FROM bg_matches
     WHERE tournament_id = ? AND round_number >= ?
     ORDER BY round_number ASC`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );
  return rows.map((row) => Number(row.round_number));
}

/**
 * Rencontres d'un tour d'arbre final, dans l'ordre d'affichage.
 *
 * `hasScoreInput` reprend mot pour mot la règle de `lib/shared/match-lock.ts` :
 * un score (même nul), un vainqueur, un forfait ou un report en attente. C'est
 * lui qui interdit de réécrire un tour déjà entamé — et il ignore les byes,
 * dont le 1-0 est posé par le moteur et non saisi par une équipe.
 */
async function loadPlayoffRoundMatches(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<PlayoffMatchRow[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      id: number;
      bracket: string;
      status: string;
      team1_id: number | null;
      team2_id: number | null;
      team1_score: number | null;
      team2_score: number | null;
      winner_team_id: number | null;
      loser_team_id: number | null;
      forfeit_team_id: number | null;
      is_bye: number | null;
    })[]
  >(
    `SELECT id, bracket, status, team1_id, team2_id, team1_score, team2_score,
            winner_team_id, loser_team_id, forfeit_team_id, is_bye
     FROM bg_matches
     WHERE tournament_id = ? AND round_number = ?
     ORDER BY match_number ASC`,
    [tournamentId, round],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    bracket: String(row.bracket),
    status: String(row.status),
    teamAId: row.team1_id === null ? null : Number(row.team1_id),
    teamBId: row.team2_id === null ? null : Number(row.team2_id),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    hasScoreInput:
      Number(row.is_bye ?? 0) !== 1 &&
      row.team1_id !== null &&
      row.team2_id !== null &&
      (row.team1_score !== null ||
        row.team2_score !== null ||
        row.winner_team_id !== null ||
        row.forfeit_team_id != null ||
        String(row.status) === "AWAITING_CONFIRMATION"),
  }));
}

/**
 * Pose un tour d'arbre final conformément au plan.
 *
 * Les rencontres déjà en place sont réécrites **sur place** quand le plan a la
 * même forme : leur identifiant est une adresse publique (lien profond vers un
 * match, diffusion, horaire annoncé), et la perdre pour un changement d'engagée
 * serait payer cher une correction de score. Sinon — le plan n'a plus le même
 * nombre de rencontres, ou plus les mêmes natures — le tour est refait à neuf.
 */
async function writePlayoffRound(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  plan: PlayoffRoundPlan,
  existing: PlayoffMatchRow[],
): Promise<void> {
  const sameShape =
    existing.length === plan.length &&
    plan.every((entry, index) => entry.bracket === existing[index].bracket);

  let reusable = existing;
  if (!sameShape) {
    if (existing.length > 0) {
      await conn.execute(`DELETE FROM bg_matches WHERE tournament_id = ? AND round_number = ?`, [
        tournamentId,
        round,
      ]);
    }
    reusable = [];
  }

  for (let index = 0; index < plan.length; index += 1) {
    const { bracket, pairing } = plan[index];
    const matchId =
      reusable[index]?.id ?? (await createMatch(conn, tournamentId, bracket, round, index + 1, 0));

    // Le résultat est remis à zéro en même temps que les engagées : un tour
    // réécrit n'a pas été joué, et laisser un vainqueur derrière ferait avancer
    // l'arbre sur une rencontre qui n'existe plus.
    const isBye = pairing.teamBId === null;
    await conn.execute(
      `UPDATE bg_matches SET
        team1_id = ?, team2_id = ?, status = ?, is_bye = ?,
        team1_score = ?, team2_score = ?,
        winner_team_id = ?, loser_team_id = NULL, forfeit_team_id = NULL
       WHERE id = ?`,
      [
        pairing.teamAId,
        pairing.teamBId,
        isBye ? "COMPLETED" : "READY",
        isBye ? 1 : 0,
        isBye ? 1 : null,
        isBye ? 0 : null,
        isBye ? pairing.teamAId : null,
        matchId,
      ],
    );
  }

  // Les rappels déjà partis nommaient les anciennes engagées : les effacer fait
  // repartir le cycle (`lib/server/tournaments/match-reminders.ts`), donc
  // réannoncer la rencontre à celles qui la disputent réellement — même
  // raisonnement qu'une manche reprogrammée.
  //
  // Seules les rencontres dont le couple **change** sont concernées. Un tour
  // périmé n'en compte souvent qu'une : effacer les rappels du tour entier
  // renverrait le même message privé aux joueurs d'une demi-finale que la
  // correction n'a pas touchée.
  const rewritten = reusable
    .filter(
      (match, index) =>
        index < plan.length &&
        (match.teamAId !== plan[index].pairing.teamAId ||
          match.teamBId !== plan[index].pairing.teamBId),
    )
    .map((match) => match.id);
  if (rewritten.length > 0) {
    await conn.execute(
      `DELETE FROM bg_match_reminders WHERE match_id IN (${rewritten.map(() => "?").join(", ")})`,
      rewritten,
    );
  }
}

/**
 * Réaligne l'arbre final sur le résultat des tours amont.
 *
 * `finalizePlayoffsIfDone` ne sait que **poser** le tour suivant : une fois les
 * demi-finales créées, corriger un quart de finale n'en changeait plus les
 * participantes — le tour existait déjà, et plus rien ne le relisait. C'est
 * l'exact pendant de `roundPairingsAreStale` en qualification, appliqué aux
 * tours de play-off.
 *
 * Le premier tour se relit sur le **classement** (une correction en
 * qualification peut réécrire qui est qualifiée, et dans quel ordre), les
 * suivants sur les vainqueurs du tour précédent. Un tour périmé est réécrit, et
 * tout ce qui en descendait est supprimé : le tour réécrit n'est plus joué, il
 * ne qualifie donc plus personne. Ce qu'il faut reposer le sera par le chemin
 * ordinaire, une fois ce tour terminé.
 *
 * Un tour portant la moindre saisie n'est **jamais** réécrit. Le cas ne devrait
 * pas se présenter — `checkDownstreamMatchesHaveNoScores` refuse la correction
 * amont —, mais entre un arbre périmé, qui se corrige, et un score attribué à
 * une équipe qui ne l'a pas disputé, qui ne se voit plus, le choix est fait.
 */
async function repairPlayoffBracket(
  conn: PoolConnection,
  tournamentId: number,
  standings: EnduranceStanding[],
  config: EnduranceConfig,
): Promise<void> {
  const rounds = await loadPlayoffRoundNumbers(conn, tournamentId);
  if (rounds.length === 0) return;

  let plan = planPlayoffFirstRound(selectQualifiedTeamIds(standings, config), config);

  for (const round of rounds) {
    const matches = await loadPlayoffRoundMatches(conn, tournamentId, round);

    if (playoffRoundIsStale(plan, matches)) {
      if (matches.some((match) => match.hasScoreInput)) return;

      await writePlayoffRound(conn, tournamentId, round, plan, matches);
      await conn.execute(`DELETE FROM bg_matches WHERE tournament_id = ? AND round_number > ?`, [
        tournamentId,
        round,
      ]);
      return;
    }

    // Tour conforme : le suivant se déduit de ses résultats — encore faut-il
    // qu'il soit joué. Une finale (une seule rencontre décisive) ne mène nulle
    // part : `planNextPlayoffRound` rend un plan vide, et il n'y a plus rien à
    // relire en aval.
    const decisive = matches.filter((match) => match.bracket !== "THIRD_PLACE");
    if (decisive.some((match) => match.status !== "COMPLETED")) return;

    plan = planNextPlayoffRound(decisive);
    if (plan.length === 0) return;
  }
}

/**
 * Enchaîne les tours de play-offs : dès qu'un tour est complet, crée le suivant
 * avec les vainqueurs (et la petite finale lorsqu'il ne reste que les demies).
 *
 * Le tirage du tour suivant est celui du module pur (`planNextPlayoffRound`),
 * le même que relit `repairPlayoffBracket` : poser un tour et le réparer ne
 * peuvent pas diverger.
 */
async function finalizePlayoffsIfDone(conn: PoolConnection, tournamentId: number): Promise<void> {
  const rounds = await loadPlayoffRoundNumbers(conn, tournamentId);
  if (rounds.length === 0) return;

  const lastRound = rounds[rounds.length - 1];
  const matches = await loadPlayoffRoundMatches(conn, tournamentId, lastRound);

  const decisive = matches.filter((match) => match.bracket !== "THIRD_PLACE");
  if (decisive.length === 0 || decisive.some((match) => match.status !== "COMPLETED")) return;

  // Une seule rencontre décisive terminée = finale jouée : reste à s'assurer que
  // la petite finale l'est aussi avant de clore.
  if (decisive.length === 1) {
    if (matches.some((match) => match.status !== "COMPLETED")) return;
    const standings = await loadEnduranceStandings(conn, tournamentId);
    await finalizeEndurance(conn, tournamentId, standings, matches);
    return;
  }

  const plan = planNextPlayoffRound(decisive);
  if (plan.length === 0) return;

  await writePlayoffRound(conn, tournamentId, lastRound + 1, plan, []);
}

/** Classement final : podium issu des play-offs, puis ordre d'élimination. */
async function finalizeEndurance(
  conn: PoolConnection,
  tournamentId: number,
  standings: EnduranceStanding[],
  finalMatches: {
    bracket: string;
    winnerTeamId: number | null;
    loserTeamId: number | null;
  }[] = [],
): Promise<void> {
  const podium: number[] = [];

  const final = finalMatches.find((match) => match.bracket !== "THIRD_PLACE");
  const thirdPlace = finalMatches.find((match) => match.bracket === "THIRD_PLACE");

  if (final?.winnerTeamId) podium.push(final.winnerTeamId);
  if (final?.loserTeamId) podium.push(final.loserTeamId);
  if (thirdPlace?.winnerTeamId) podium.push(thirdPlace.winnerTeamId);
  if (thirdPlace?.loserTeamId) podium.push(thirdPlace.loserTeamId);

  const ranked = assignRanks(standings)
    .map((standing) => standing.teamId)
    .filter((teamId) => !podium.includes(teamId));

  const order = [...podium, ...ranked];

  for (let index = 0; index < order.length; index += 1) {
    await conn.execute(
      `UPDATE bg_tournament_registrations SET final_rank = ? WHERE tournament_id = ? AND team_id = ?`,
      [index + 1, tournamentId, order[index]],
    );
  }

  await finishTournament(conn, tournamentId);
}

/**
 * Déclare l'abandon d'une équipe : elle quitte le tournoi et son capital tombe
 * à 0. Le classement est ensuite rejoué (l'abandon est une entrée du rejeu).
 *
 * **Réservé à la phase qualificative.** Cette fonction ne sait clore qu'un match
 * de la manche courante (`endurance_current_round`) ; l'arbre final vit à partir
 * de `PLAYOFF_ROUND_OFFSET`, hors de sa portée. Laisser passer un abandon en
 * play-offs marquerait l'équipe `FORFEIT` au classement tout en la laissant
 * engagée dans un match ouvert que rien ne viendrait clore — et le rejeu
 * daterait l'abandon d'une manche qualificative qu'elle avait en réalité jouée.
 * Un forfait de play-off se tranche sur le match lui-même (`adminResolveMatch`
 * avec `forfeitTeamId`), qui fait avancer l'arbre.
 *
 * **Et à un tournoi en cours**, comme `forfeitSurvivalTeam` et
 * `forfeitSwissTeam`. La garde manquait au seul mode endurance, et le cas est
 * atteignable : un tournoi clos par `startEndurancePlayoffs` faute de qualifiées
 * garde `endurance_playoffs_started` à 0, si bien que le contrôle suivant le
 * laissait passer. L'abandon s'écrivait alors sur une archive — statut
 * `FORFEIT`, capital à 0, manche courante close — pour un tournoi que plus
 * personne ne joue. L'interface refusait déjà (`canForfeitTeam` exige
 * `RUNNING`) ; il n'y avait que le serveur à convaincre.
 *
 * @throws NOT_BG_SURVIE | TOURNAMENT_NOT_RUNNING | ENDURANCE_PLAYOFFS_STARTED
 *         | TEAM_NOT_IN_TOURNAMENT | TEAM_ALREADY_OUT
 */
export async function forfeitEnduranceTeam(
  tournamentId: number,
  teamId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") throw new Error("NOT_BG_SURVIE");
  // Avant le contrôle des play-offs, comme en Survie et en Ronde suisse : sur un
  // tournoi clos, « le tournoi n'est pas en cours » est le vrai motif, et il
  // reste juste dans le cas que le contrôle suivant ne voit pas — un tournoi
  // fini faute de qualifiées garde `endurance_playoffs_started` à 0.
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
  if (Number(tournament.endurance_playoffs_started) === 1) {
    throw new Error("ENDURANCE_PLAYOFFS_STARTED");
  }

  const [rows] = await conn.execute<(RowDataPacket & { status: string })[]>(
    `SELECT status FROM bg_endurance_standings WHERE tournament_id = ? AND team_id = ? LIMIT 1`,
    [tournamentId, teamId],
  );
  if (rows.length === 0) throw new Error("TEAM_NOT_IN_TOURNAMENT");
  if (rows[0].status !== "ACTIVE") throw new Error("TEAM_ALREADY_OUT");

  const currentRound = Math.max(Number(tournament.endurance_current_round), 1);

  await conn.execute(
    `UPDATE bg_endurance_standings
     SET status = 'FORFEIT', points = 0, eliminated_round = ?
     WHERE tournament_id = ? AND team_id = ?`,
    [currentRound, tournamentId, teamId],
  );

  // Clôt le match en cours de l'équipe partie, sans quoi la manche ne pourrait
  // plus se terminer et la suivante ne serait jamais appariée. Le match est
  // marqué forfait et porte le score plein du format du tournoi (FT3 → 3-0) :
  // le rejeu en tire le barème d'endurance, et l'affichage montre la même chose
  // qu'une rencontre réellement gagnée sur ce score.
  const [pending] = await conn.execute<
    (RowDataPacket & { id: number; team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT id, team1_id, team2_id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?
       AND status <> 'COMPLETED' AND (team1_id = ? OR team2_id = ?)
     LIMIT 1`,
    [tournamentId, currentRound, teamId, teamId],
  );

  if (pending.length > 0) {
    const match = pending[0];
    const opponentId = Number(match.team1_id) === teamId ? match.team2_id : match.team1_id;
    const team1IsForfeit = Number(match.team1_id) === teamId;
    const wonMaps = forfeitMapCount(matchFormatOf(tournament));

    await conn.execute(
      `UPDATE bg_matches SET
        status = 'COMPLETED',
        winner_team_id = ?,
        loser_team_id = ?,
        forfeit_team_id = ?,
        team1_score = ?,
        team2_score = ?
       WHERE id = ?`,
      [
        opponentId,
        teamId,
        teamId,
        team1IsForfeit ? 0 : wonMaps,
        team1IsForfeit ? wonMaps : 0,
        match.id,
      ],
    );
  }

  await reconcileEndurance(tournamentId, conn);
}

/**
 * Pénalités du tournoi telles qu'elles s'affichent : avec leur motif, l'engagé
 * visé et l'auteur de la sanction.
 *
 * L'auteur est nommé parce qu'une sanction se conteste : « −3 » sans arbitre
 * derrière n'est adressable à personne. Un compte effacé laisse la ligne en
 * place (`created_by` passe à `NULL`) — la pénalité reste due.
 */
async function loadPenaltyRows(conn: PoolConnection, tournamentId: number) {
  // Borne du retrait, relue une fois pour tout le tableau : une sanction de la
  // manche N ne se retire plus dès qu'une manche postérieure a été entamée
  // (même règle que `liftEndurancePenalty`, même prédicat).
  const lockRound = await lastRoundWithScoreInput(conn, tournamentId);

  const [rows] = await conn.execute<
    (RowDataPacket & {
      id: number;
      team_id: number;
      team_name: string;
      round_number: number;
      points: number;
      reason: string;
      author_pseudo: string | null;
      created_at: Date | string;
    })[]
  >(
    `SELECT p.id, p.team_id, p.round_number, p.points, p.reason, p.created_at,
            t.name AS team_name, u.pseudo AS author_pseudo
     FROM bg_endurance_penalties p
     JOIN bg_teams t ON t.id = p.team_id
     LEFT JOIN bg_users u ON u.id = p.created_by
     WHERE p.tournament_id = ?
     ORDER BY p.round_number ASC, p.id ASC`,
    [tournamentId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    teamId: Number(row.team_id),
    teamName: row.team_name,
    round: Number(row.round_number),
    points: Number(row.points),
    reason: row.reason,
    authorPseudo: row.author_pseudo,
    createdAt: toIso(row.created_at),
    // `>=` et non `>` : la manche de la sanction elle-même peut être entamée,
    // la pénalité tombe de toute façon après ses matchs.
    removable: Number(row.round_number) >= lockRound,
  }));
}

/**
 * Inflige une pénalité d'endurance à un engagé, puis rejoue le tournoi.
 *
 * **Réservé à la phase qualificative**, et pour la même raison que l'abandon :
 * le capital d'endurance ne décide plus rien une fois l'arbre lancé — une
 * sanction y serait sans effet, mais figurerait quand même au tableau comme si
 * elle en avait un.
 *
 * La manche portée par la sanction est la **manche courante** : c'est ce qui la
 * situe dans la chronologie. Elle pèse donc sur l'appariement de la suivante,
 * et `reconcileEndurance` réapparie de lui-même une manche déjà posée mais
 * jamais jouée — exactement comme après une correction de score.
 *
 * **Sur un tournoi en cours seulement**, comme l'abandon en Survie et en Ronde
 * suisse : `reconcileEndurance` s'arrête net sur un tournoi `FINISHED`, si bien
 * qu'une sanction y serait écrite sans jamais être rejouée — le classement
 * stocké et le podium garderaient leurs valeurs pendant que `loadEnduranceMeta`,
 * qui rejoue toujours, afficherait une championne au capital amputé. Le cas est
 * atteignable : un tournoi clos par `startEndurancePlayoffs` faute de qualifiées
 * garde `endurance_playoffs_started` à 0.
 *
 * @throws NOT_BG_SURVIE | TOURNAMENT_NOT_RUNNING | ENDURANCE_PLAYOFFS_STARTED
 *         | TEAM_NOT_IN_TOURNAMENT | TEAM_ALREADY_OUT | INVALID_PENALTY
 */
export async function applyEndurancePenalty(
  tournamentId: number,
  teamId: number,
  points: number,
  reason: string,
  authorId: number | null,
  conn: PoolConnection,
): Promise<{ reason: string }> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") throw new Error("NOT_BG_SURVIE");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
  if (Number(tournament.endurance_playoffs_started) === 1) {
    throw new Error("ENDURANCE_PLAYOFFS_STARTED");
  }

  // La même règle que le formulaire, appliquée par le même module : le serveur
  // reste le juge, l'interface n'en est que la première passe.
  if (checkEndurancePenalty(points, reason) !== null) throw new Error("INVALID_PENALTY");

  const [rows] = await conn.execute<(RowDataPacket & { status: string })[]>(
    `SELECT status FROM bg_endurance_standings WHERE tournament_id = ? AND team_id = ? LIMIT 1`,
    [tournamentId, teamId],
  );
  if (rows.length === 0) throw new Error("TEAM_NOT_IN_TOURNAMENT");
  if (rows[0].status !== "ACTIVE") throw new Error("TEAM_ALREADY_OUT");

  // Avant la première manche, la sanction porte tout de même sur la manche 1 :
  // le rejeu ne connaît pas de manche 0, et une pénalité prononcée au coup
  // d'envoi doit peser dès le premier appariement.
  const round = Math.max(Number(tournament.endurance_current_round), 1);

  // Le motif normalisé est **rendu** à l'appelant, et non renormalisé par lui :
  // la ligne du journal Discord doit porter le texte tel qu'il est stocké, sans
  // quoi le canal montrerait une espacement que la page ne montre pas.
  const normalized = normalizePenaltyReason(reason);

  await conn.execute(
    `INSERT INTO bg_endurance_penalties
      (tournament_id, team_id, round_number, points, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tournamentId, teamId, round, Math.floor(points), normalized, authorId],
  );

  await reconcileEndurance(tournamentId, conn);

  return { reason: normalized };
}

/**
 * Retire une pénalité, puis rejoue le tournoi.
 *
 * C'est **la** façon de corriger une sanction saisie de travers : le rejeu
 * défait le retrait de points et tout ce qu'il a entraîné — l'élimination qu'il
 * avait provoquée, la coupe sous plafond qui en découlait, l'appariement de la
 * manche suivante tant qu'elle n'est pas entamée. Une seconde pénalité de sens
 * inverse ne saurait pas faire cela, et laisserait au classement deux sanctions
 * dont l'une est un pansement.
 *
 * Refusé une fois l'arbre lancé, comme l'est l'application : le rejeu rendrait
 * ses points à l'équipe, et pourrait la ramener « en lice » alors que le
 * plateau des play-offs est déjà tiré sans elle — un classement qui contredit
 * l'arbre affiché juste au-dessus. La sanction devient donc définitive au même
 * instant que le capital cesse de décider quoi que ce soit.
 *
 * Refusé **aussi** dès qu'une manche postérieure porte une saisie
 * (`ENDURANCE_ROUND_ALREADY_PLAYED`) : c'est la règle de `match-lock`, que le
 * retrait est le seul geste du mode à pouvoir enfreindre puisqu'il remonte le
 * temps. Sans elle, lever une sanction de la manche 2 à la manche 7 rendrait
 * son capital **intact** à une équipe qui n'a pas joué les quatre manches
 * entre-temps — le rejeu ne réapparie que la manche courante, les autres
 * restent telles qu'elles ont été jouées, et l'équipe ressuscitée passerait
 * devant toutes celles qui y ont perdu des maps.
 *
 * @throws NOT_BG_SURVIE | TOURNAMENT_NOT_RUNNING | ENDURANCE_PLAYOFFS_STARTED
 *         | ENDURANCE_ROUND_ALREADY_PLAYED | PENALTY_NOT_FOUND
 */
export async function liftEndurancePenalty(
  tournamentId: number,
  penaltyId: number,
  conn: PoolConnection,
): Promise<{ teamId: number; points: number }> {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") throw new Error("NOT_BG_SURVIE");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
  if (Number(tournament.endurance_playoffs_started) === 1) {
    throw new Error("ENDURANCE_PLAYOFFS_STARTED");
  }

  // La pénalité est relue **par son tournoi** : un identifiant de sanction
  // appartenant à un autre plateau ne doit pas s'effacer depuis cette page.
  const [rows] = await conn.execute<
    (RowDataPacket & { team_id: number; points: number; round_number: number })[]
  >(
    `SELECT team_id, points, round_number FROM bg_endurance_penalties
     WHERE id = ? AND tournament_id = ? LIMIT 1`,
    [penaltyId, tournamentId],
  );
  if (rows.length === 0) throw new Error("PENALTY_NOT_FOUND");

  if (await laterRoundHasScoreInput(conn, tournamentId, Number(rows[0].round_number))) {
    throw new Error("ENDURANCE_ROUND_ALREADY_PLAYED");
  }

  await conn.execute(`DELETE FROM bg_endurance_penalties WHERE id = ? AND tournament_id = ?`, [
    penaltyId,
    tournamentId,
  ]);

  await reconcileEndurance(tournamentId, conn);

  return { teamId: Number(rows[0].team_id), points: Number(rows[0].points) };
}

/** Métadonnées d'affichage : barème, manche courante, classement complet. */
export async function loadEnduranceMeta(conn: PoolConnection, tournamentId: number) {
  const tournament = await loadTournament(conn, tournamentId);
  if (!tournament || tournament.format !== "BG_SURVIE") return null;

  const config = configOf(tournament);

  const [rows] = await conn.execute<
    (RowDataPacket & {
      team_id: number;
      team_name: string;
      logo_url: string | null;
      seed: number;
      points: number;
      wins: number;
      losses: number;
      status: EnduranceStatus;
      eliminated_round: number | null;
      rank: number;
    })[]
  >(
    `SELECT s.team_id, s.seed, s.points, s.wins, s.losses, s.status, s.eliminated_round, s.\`rank\`,
            t.name AS team_name, t.logo_url
     FROM bg_endurance_standings s
     JOIN bg_teams t ON t.id = s.team_id
     WHERE s.tournament_id = ?
     ORDER BY s.\`rank\` ASC, s.seed ASC`,
    [tournamentId],
  );

  // Historique manche par manche — la lecture « feuille de calcul » du mode.
  // Il n'est **pas** stocké : le même rejeu qui produit le classement le
  // produit, si bien qu'une correction de score le refait sans migration ni
  // colonne à tenir à jour. Les abandons se relisent ici depuis les lignes déjà
  // chargées, plutôt que par une seconde requête sur la même table.
  const penalties = await loadPenaltyRows(conn, tournamentId);

  const detailed = replayEnduranceDetailed({
    teams: rows.map((row) => ({ teamId: Number(row.team_id), seed: Number(row.seed) })),
    matches: await loadQualificationOutcomes(conn, tournamentId),
    forfeits: rows
      .filter((row) => row.status === "FORFEIT")
      .map((row) => ({
        teamId: Number(row.team_id),
        round: Number(row.eliminated_round ?? 1),
      })),
    // Les mêmes lignes que le rejeu de `reconcileEndurance`, relues ici avec
    // leur motif : deux requêtes diraient la même chose, une seule évite qu'un
    // tableau et son classement divergent.
    penalties: penalties.map((penalty) => ({
      teamId: penalty.teamId,
      round: penalty.round,
      points: penalty.points,
    })),
    config,
    lastRound: Number(tournament.endurance_current_round),
    matchFormat: matchFormatOf(tournament),
  });

  return {
    startPoints: config.startPoints,
    winDelta: config.winDelta,
    lossDelta: config.lossDelta,
    forfeitMaps: forfeitMapCount(matchFormatOf(tournament)),
    playoffSize: config.playoffSize,
    maxRounds: config.maxRounds,
    currentRound: Number(tournament.endurance_current_round),
    playoffsStarted: Number(tournament.endurance_playoffs_started) === 1,
    rounds: detailed.rounds,
    penalties,
    standings: rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      logoUrl: row.logo_url,
      seed: Number(row.seed),
      points: Number(row.points),
      wins: Number(row.wins),
      losses: Number(row.losses),
      status: row.status,
      eliminatedRound: row.eliminated_round === null ? null : Number(row.eliminated_round),
      rank: Number(row.rank),
      // Le cumul vient du **rejeu**, pas d'une somme des lignes : une sanction
      // visant une équipe déjà sortie n'a rien retiré, et l'annoncer au
      // classement ferait mentir la colonne d'endurance.
      penaltyPoints: detailed.penaltyTotals.get(Number(row.team_id)) ?? 0,
      rounds: detailed.history.get(Number(row.team_id)) ?? [],
    })),
  };
}

export type EnduranceMeta = NonNullable<Awaited<ReturnType<typeof loadEnduranceMeta>>>;
