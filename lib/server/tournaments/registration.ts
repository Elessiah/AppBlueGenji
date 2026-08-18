import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { ensureSoloEntry, findSoloEntry } from "@/lib/server/solo-entries-service";
import { isSoloTournament } from "@/lib/shared/participants";
import type { TournamentRow } from "./_internal";
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

/**
 * Engagé d'un joueur dans un tournoi donné : son équipe active en tournoi par
 * équipes, son entrée solo en tournoi individuel. `null` quand il n'a rien à
 * engager (aucune équipe, ou aucune entrée solo encore créée).
 *
 * C'est la résolution à utiliser partout où l'on demandait « l'équipe du
 * joueur » à propos d'un tournoi : inscription, report de score, forfait.
 */
export async function resolveUserEntrantTeamId(
  connection: PoolConnection,
  tournament: Pick<TournamentRow, "participant_type">,
  userId: number,
): Promise<number | null> {
  if (isSoloTournament(tournament.participant_type)) {
    return findSoloEntry(connection, userId);
  }

  const activeTeam = await getUserActiveTeam(userId);
  return activeTeam?.teamId ?? null;
}

/**
 * Inscription à l'initiative du joueur : son équipe active, ou lui-même via son
 * entrée solo si le tournoi est individuel.
 */
export async function registerCurrentUserTeam(
  connection: PoolConnection,
  tournamentId: number,
  userId: number,
): Promise<void> {
  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament) {
    throw new Error("TOURNAMENT_NOT_FOUND");
  }

  // L'entrée solo n'est créée qu'ici : un joueur qui n'a jamais participé à un
  // tournoi individuel n'a pas de ligne parasite dans `bg_teams`.
  const teamId = isSoloTournament(tournament.participant_type)
    ? await ensureSoloEntry(connection, userId)
    : (await getUserActiveTeam(userId))?.teamId ?? null;

  if (teamId === null) {
    throw new Error("NO_ACTIVE_TEAM");
  }

  await registerTeam(connection, tournamentId, teamId);
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
  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament || tournament.state !== "REGISTRATION") return false;

  const solo = isSoloTournament(tournament.participant_type);
  const teamId = await resolveUserEntrantTeamId(connection, tournament, userId);

  // En individuel, l'absence d'entrée solo n'est pas un obstacle : elle sera
  // créée à l'inscription. En tournoi par équipes, il faut une équipe active.
  if (teamId === null) return solo;

  const [count] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_tournament_registrations
     WHERE tournament_id = ? AND team_id = ?`,
    [tournamentId, teamId],
  );

  return Number(count[0]?.c ?? 0) === 0;
}
