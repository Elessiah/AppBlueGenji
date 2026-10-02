/**
 * Tournois multi-phase du jeu de test : phases écrites dès la création, puis
 * déroulées par l'orchestration réelle (`reconcilePhases`).
 */

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { createDoubleEliminationBracket } from "../tournaments/bracket-double";
import { createSingleEliminationBracket } from "../tournaments/bracket-single";
import { initializeMultiTournament, reconcilePhases, startPhase } from "../tournaments/phases";
import { insertPhases, loadPhases, setCurrentPhase } from "../tournaments/phases-repository";
import { getMatchRows, loadTournamentRow } from "../tournaments/repository";
import { finalizeMatch } from "../tournaments/scoring";
import type { SeedPhase } from "./cases";
import { playMatch, readyMatches } from "./match-play";

type SeedPhaseRow = Awaited<ReturnType<typeof loadPhases>>[number];

/** Phases d'un cas de la matrice → configuration écrite par `insertPhases`. */
function toPhaseConfigs(phases: SeedPhase[]) {
  return phases.map((phase, index) => ({
    position: index + 1,
    format: phase.format,
    name: null,
    qualifierMode: phase.qualifierMode,
    qualifierValue: phase.qualifierValue,
    swissTotalRounds: phase.swissTotalRounds ?? null,
    survivalRoundsBeforeFirstCut: phase.survivalRoundsBeforeFirstCut ?? null,
    survivalRoundsPerCut: phase.survivalRoundsPerCut ?? null,
    hasThirdPlaceMatch: phase.hasThirdPlaceMatch ?? false,
  }));
}

/**
 * Écrit les phases d'un tournoi multi-mode encore avant son lancement : la
 * création les pose dès l'origine, et l'aperçu du plateau en a besoin.
 */
export async function insertPreLaunchSeedPhases(
  db: Pool,
  tournamentId: number,
  phases: SeedPhase[]
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await insertPhases(connection, tournamentId, toPhaseConfigs(phases));
  } finally {
    connection.release();
  }
}

/**
 * Démarre une phase `PENDING` d'un tournoi multi-phase.
 *
 * @returns `false` si le tournoi n'a pas pu être relu (la simulation s'arrête).
 */
async function startSeedPhase(
  connection: PoolConnection,
  tournamentId: number,
  currentPhase: SeedPhaseRow
): Promise<boolean> {
  await setCurrentPhase(connection, tournamentId, currentPhase.id);

  // On passe par l'orchestrateur reel plutot que de reimplementer le
  // demarrage d'une phase : le seed teste ainsi le meme chemin que la prod.
  if (currentPhase.format === "SWISS" || currentPhase.format === "SURVIVAL") {
    await startPhase(tournamentId, currentPhase.id, connection);
    await reconcilePhases(tournamentId, connection);
    return true;
  }
  const bracket = currentPhase.format as "SINGLE" | "DOUBLE";
  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament) return false;
  const teamIds = await loadPhaseTeamIds(connection, currentPhase.id);

  if (bracket === "DOUBLE") {
    await createDoubleEliminationBracket(connection, tournament, teamIds, { phaseId: currentPhase.id });
  } else {
    await createSingleEliminationBracket(connection, tournament, teamIds, { phaseId: currentPhase.id });
  }
  return true;
}

/**
 * Joue les vagues de matchs prêts d'une phase, jusqu'à épuisement ou jusqu'à
 * `playWaves` vagues pour un tournoi laissé en cours.
 *
 * @returns Le nombre de matchs joués et de vagues écoulées.
 */
async function playSeedPhaseWaves(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
  finish: boolean,
  playWaves: number,
  winsRequired: number
): Promise<{ played: number; waves: number }> {
  let played = 0;
  let phaseWaves = 0;

  while (true) {
    const allMatches = await getMatchRows(connection, tournamentId);
    const phaseMatches = allMatches.filter((m) => Number(m.phase_id) === phaseId);
    const phaseReady = readyMatches(phaseMatches);
    if (phaseReady.length === 0) break;
    if (!finish && phaseWaves >= playWaves) break;

    for (const m of phaseReady) {
      await finalizeMatch(
        connection,
        tournamentId,
        m,
        playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
      );
      await reconcilePhases(tournamentId, connection);
      played++;
    }
    phaseWaves++;
  }
  return { played, waves: phaseWaves };
}

// Génère un tournoi multi-phase. Persiste les phases dans la base, initialise
// le tournoi, puis joue les matchs à travers les phases en utilisant
// l'orchestration réelle (reconcilePhases pour l'avancement).
export async function generateMultiPhaseTournament(
  db: Pool,
  tournamentId: number,
  phases: SeedPhase[],
  finish: boolean,
  playWaves: number,
  winsRequired: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await insertPhases(connection, tournamentId, toPhaseConfigs(phases));
    await initializeMultiTournament(tournamentId, connection);

    let totalPlayed = 0;
    let currentWaves = 0;
    // Garde-fou anti-blocage : une phase qui n'avance plus (aucun match joué et
    // aucun changement d'état) ferait tourner cette boucle à l'infini quand
    // `finish` est vrai, puisque plus rien ne la fait sortir. On préfère un
    // avertissement visible et un tournoi laissé en l'état à un seed suspendu.
    let lastSignature = "";

    while (true) {
      const loadedPhases = await loadPhases(connection, tournamentId);
      const currentPhase = loadedPhases.find((p) => p.state === "PENDING" || p.state === "RUNNING");

      if (!currentPhase) break;

      const phaseStates = loadedPhases.map((p) => `${p.id}:${p.state}`).join(",");
      const signature = `${totalPlayed}|${phaseStates}`;
      if (signature === lastSignature) {
        console.warn(
          `    ⚠ multi-phase : phase ${currentPhase.position} (${currentPhase.format}) bloquée, ` +
            `tournoi #${tournamentId} laissé en l'état`
        );
        break;
      }
      lastSignature = signature;

      if (currentPhase.state === "PENDING" && !(await startSeedPhase(connection, tournamentId, currentPhase))) {
        break;
      }

      const phasePlay = await playSeedPhaseWaves(
        connection,
        tournamentId,
        currentPhase.id,
        finish,
        playWaves,
        winsRequired
      );
      totalPlayed += phasePlay.played;
      currentWaves += phasePlay.waves;

      await reconcilePhases(tournamentId, connection);

      if (!finish && currentWaves >= playWaves) break;

      const [rows] = await connection.execute<(RowDataPacket & { state: string })[]>(
        `SELECT state FROM bg_tournaments WHERE id = ? LIMIT 1`,
        [tournamentId]
      );
      if (rows[0]?.state === "FINISHED") break;
    }

    console.log(`    ↳ multi-phase : ${totalPlayed} matchs simulés`);
  } finally {
    connection.release();
  }
}

// Helper pour récupérer les team IDs d'une phase
async function loadPhaseTeamIds(
  connection: PoolConnection,
  phaseId: number
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id FROM bg_tournament_phase_teams WHERE phase_id = ? ORDER BY seed ASC`,
    [phaseId]
  );
  return rows.map((r) => Number(r.team_id));
}
