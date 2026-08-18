import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { syncTournamentState } from "./state";
import { loadTournamentRow } from "./repository";

/**
 * Inscrit une équipe donnée. Cœur commun à l'inscription d'un joueur (son
 * équipe active) et à l'inscription d'une équipe fantôme par le staff : mêmes
 * contrôles d'état, de doublon et de capacité, même attribution de seed.
 */
async function registerTeam(
  connection: PoolConnection,
  tournamentId: number,
  teamId: number,
): Promise<void> {
  const { row: tournament } = await syncTournamentState(connection, tournamentId);
  if (!tournament) {
    throw new Error("TOURNAMENT_NOT_FOUND");
  }

  if (tournament.state !== "REGISTRATION") {
    throw new Error("REGISTRATION_CLOSED");
  }

  const [alreadyRegistered] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_tournament_registrations
     WHERE tournament_id = ?
       AND team_id = ?`,
    [tournamentId, teamId],
  );

  if (Number(alreadyRegistered[0]?.c ?? 0) > 0) {
    throw new Error("ALREADY_REGISTERED");
  }

  const [registrationsCount] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_tournament_registrations
     WHERE tournament_id = ?`,
    [tournamentId],
  );

  const registeredTeams = Number(registrationsCount[0]?.c ?? 0);
  if (registeredTeams >= Number(tournament.max_teams)) {
    throw new Error("TOURNAMENT_FULL");
  }

  await connection.execute(
    `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed)
     VALUES (?, ?, ?)`,
    [tournamentId, teamId, registeredTeams + 1],
  );
}

export async function registerCurrentUserTeam(
  connection: PoolConnection,
  tournamentId: number,
  userId: number,
): Promise<void> {
  const activeTeam = await getUserActiveTeam(userId);

  if (!activeTeam) {
    throw new Error("NO_ACTIVE_TEAM");
  }

  await registerTeam(connection, tournamentId, activeTeam.teamId);
}

/**
 * Inscription d'une équipe **fantôme** par le staff (permission `tournaments`).
 * Le contrôle « l'équipe est bien fantôme » est fait par l'appelant : cette
 * fonction refuse simplement toute équipe inexistante ou dissoute.
 */
export async function registerTeamById(
  connection: PoolConnection,
  tournamentId: number,
  teamId: number,
): Promise<void> {
  const [teams] = await connection.execute<(RowDataPacket & { deleted_at: Date | null })[]>(
    `SELECT deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );

  if (teams.length === 0) throw new Error("TEAM_NOT_FOUND");
  if (teams[0].deleted_at !== null) throw new Error("TEAM_ALREADY_DELETED");

  await registerTeam(connection, tournamentId, teamId);
}

export async function canUserRegister(
  connection: PoolConnection,
  tournamentId: number,
  userId: number,
): Promise<boolean> {
  const activeTeam = await getUserActiveTeam(userId);
  if (!activeTeam) return false;

  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament || tournament.state !== "REGISTRATION") return false;

  const [count] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_tournament_registrations
     WHERE tournament_id = ? AND team_id = ?`,
    [tournamentId, activeTeam.teamId],
  );

  return Number(count[0]?.c ?? 0) === 0;
}
