/**
 * Simulation des tournois à format unique (élimination simple ou double,
 * ronde suisse, survie, BlueGenji Survie) : le seed passe par l'orchestration
 * de production, puis joue des vagues de matchs tirés au sort.
 */

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import { createDoubleEliminationBracket } from "../tournaments/bracket-double";
import { createSingleEliminationBracket } from "../tournaments/bracket-single";
import {
  forfeitEnduranceTeam,
  generateEnduranceRound,
  initializeEnduranceTournament,
  reconcileEndurance,
} from "../tournaments/bg-survie";
import { finalizeTournamentIfDone } from "../tournaments/finalization";
import { getMatchRows, loadRegisteredTeamIds, loadTournamentRow } from "../tournaments/repository";
import { finalizeMatch } from "../tournaments/scoring";
import {
  forfeitSurvivalTeam,
  generateSurvivalRound,
  initializeSurvivalTournament,
  reconcileSurvival,
} from "../tournaments/survival";
import { generateSwissRound, initializeSwissTournament, reconcileSwiss } from "../tournaments/swiss";
import { playMatch, readyMatches } from "./match-play";

// Joue `waves` vagues de matchs prêts sur un bracket à élimination. `waves` à
// Infinity = jusqu'à épuisement (tournoi terminé).
async function playBracket(
  connection: PoolConnection,
  tournamentId: number,
  waves: number,
  winsRequired: number
): Promise<number> {
  let played = 0;
  for (let wave = 0; wave < waves; wave++) {
    const ready = readyMatches(await getMatchRows(connection, tournamentId));
    if (ready.length === 0) break;
    for (const m of ready) {
      await finalizeMatch(
        connection,
        tournamentId,
        m,
        playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
      );
      played++;
    }
  }
  return played;
}

// Génère un vrai bracket (single ou double élimination) via les générateurs de
// production, puis simule `playWaves` vagues de matchs joués.
export async function generateRealBracket(
  db: Pool,
  tournamentId: number,
  format: "SINGLE" | "DOUBLE",
  playWaves: number,
  finish: boolean,
  winsRequired: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) throw new Error(`Tournoi ${tournamentId} introuvable`);
    const teamIds = await loadRegisteredTeamIds(connection, tournamentId);

    if (format === "DOUBLE") {
      await createDoubleEliminationBracket(connection, tournament, teamIds);
    } else {
      await createSingleEliminationBracket(connection, tournament, teamIds);
    }

    const played = await playBracket(connection, tournamentId, finish ? Infinity : playWaves, winsRequired);
    if (finish) {
      await finalizeTournamentIfDone(connection, tournamentId);
    }
    console.log(`    ↳ bracket ${format} : ${played} matchs simulés`);
  } finally {
    connection.release();
  }
}

// Génère un tournoi « Ronde suisse » via l'orchestration de production
// (initialize + generate + reconcile), sur le même schéma que la Survie.
// `reconcileSwiss` enchaîne lui-même la ronde suivante quand la ronde courante
// est complète, et clôt le tournoi (avec classement final) à la dernière.
export async function generateSwissTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number,
  winsRequired: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await initializeSwissTournament(tournamentId, connection);
    await generateSwissRound(tournamentId, connection);
    await reconcileSwiss(tournamentId, connection);

    let waves = 0;
    let played = 0;
    while (true) {
      const ready = readyMatches(await getMatchRows(connection, tournamentId));
      if (ready.length === 0) break; // plus rien à jouer (souvent : terminé)
      if (!finish && waves >= playWaves) break; // laisse le tournoi en cours

      for (const m of ready) {
        await finalizeMatch(
          connection,
          tournamentId,
          m,
          playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
        );
        played++;
      }
      await reconcileSwiss(tournamentId, connection);
      waves++;
    }
    console.log(`    ↳ suisse : ${played} matchs simulés sur ${waves} ronde(s)`);
  } finally {
    connection.release();
  }
}

/**
 * Fait déclarer forfait, une à une, aux `forfeits` dernières équipes encore en
 * lice d'un tournoi BG Survie.
 *
 * @returns Le nombre de forfaits effectivement enregistrés.
 */
async function forfeitLastEnduranceTeams(
  connection: PoolConnection,
  tournamentId: number,
  forfeits: number
): Promise<number> {
  let forfeited = 0;
  for (let i = 0; i < forfeits; i++) {
    const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
      `SELECT team_id FROM bg_endurance_standings
         WHERE tournament_id = ? AND status = 'ACTIVE'
         ORDER BY \`rank\` DESC, seed DESC
         LIMIT 1`,
      [tournamentId]
    );
    if (rows.length === 0) break;
    try {
      await forfeitEnduranceTeam(tournamentId, Number(rows[0].team_id), connection);
      forfeited++;
    } catch {
      break;
    }
  }
  return forfeited;
}

/**
 * Simule un tournoi « BlueGenji Survie » : manches d'endurance jusqu'à la
 * bascule en play-offs, puis l'arbre final. Même schéma que la Survie —
 * initialize → generate → reconcile, puis vagues de matchs joués.
 */
export async function generateEnduranceTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number,
  forfeits: number,
  winsRequired: number,
  /** Le format du tournoi ouvre-t-il l'égalité en qualification ? */
  drawsAllowed = false
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await initializeEnduranceTournament(tournamentId, connection);
    await generateEnduranceRound(tournamentId, connection);
    await reconcileEndurance(tournamentId, connection);

    let waves = 0;
    let played = 0;
    while (true) {
      const ready = readyMatches(await getMatchRows(connection, tournamentId));
      if (ready.length === 0) break;
      if (!finish && waves >= playWaves) break;

      for (const m of ready) {
        // L'égalité ne vaut que pour la **qualification** : l'arbre final doit
        // savoir qui joue le tour suivant, et un nul l'y laisserait indécis.
        const qualification = Number(m.round_number) < PLAYOFF_ROUND_OFFSET;
        await finalizeMatch(
          connection,
          tournamentId,
          m,
          playMatch(
            Number(m.team1_id),
            Number(m.team2_id),
            winsRequired,
            drawsAllowed && qualification ? 0.2 : 0
          )
        );
        played++;
      }
      await reconcileEndurance(tournamentId, connection);
      waves++;
    }

    const forfeited = await forfeitLastEnduranceTeams(connection, tournamentId, forfeits);

    console.log(
      `    ↳ endurance : ${played} matchs simulés sur ${waves} manche(s)` +
        (forfeited > 0 ? ` · ${forfeited} forfait(s)` : "")
    );
  } finally {
    connection.release();
  }
}

// Génère un tournoi « Survie » réaliste via l'orchestration de production
// (initialize + generate + reconcile). Pour un tournoi RUNNING, on s'arrête
// après `playWaves` vagues (des matchs restent READY) ; pour un FINISHED, on
// joue jusqu'au sacre de la championne. `forfeits` équipes encore en lice
// déclarent forfait à la fin de la simulation (couvre le rééquilibrage).
export async function generateSurvivalTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number,
  forfeits: number,
  winsRequired: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await initializeSurvivalTournament(tournamentId, connection);
    await generateSurvivalRound(tournamentId, connection);
    await reconcileSurvival(tournamentId, connection);

    let waves = 0;
    let played = 0;
    while (true) {
      const ready = readyMatches(await getMatchRows(connection, tournamentId));
      if (ready.length === 0) break; // plus rien à jouer (souvent : terminé)
      if (!finish && waves >= playWaves) break; // laisse le tournoi en cours

      for (const m of ready) {
        await finalizeMatch(
          connection,
          tournamentId,
          m,
          playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
        );
        played++;
      }
      await reconcileSurvival(tournamentId, connection);
      waves++;
    }

    let forfeited = 0;
    for (let i = 0; i < forfeits; i++) {
      const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
        `SELECT team_id FROM bg_survival_standings
         WHERE tournament_id = ? AND status = 'ACTIVE'
         ORDER BY \`rank\` DESC, seed DESC
         LIMIT 1`,
        [tournamentId]
      );
      if (rows.length === 0) break;
      try {
        await forfeitSurvivalTeam(tournamentId, Number(rows[0].team_id), connection);
        forfeited++;
      } catch (error) {
        console.error(`    ✗ forfait:`, (error as Error).message);
        break;
      }
    }

    console.log(
      `    ↳ survie : ${played} matchs simulés sur ${waves} round(s)` +
        (forfeited ? `, ${forfeited} forfait(s)` : "")
    );
  } finally {
    connection.release();
  }
}
