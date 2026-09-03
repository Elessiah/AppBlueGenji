import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { ensureSoloEntry, findSoloEntry } from "@/lib/server/solo-entries-service";
import { isSoloTournament } from "@/lib/shared/participants";
import type { TournamentRow } from "./_internal";
import { queueBotLog } from "./bot-logs";
import { syncTournamentState } from "./state";
import { loadTournamentRow } from "./repository";

/**
 * Inscrit une équipe donnée. Cœur commun à l'inscription d'un joueur (son
 * équipe active) et à l'inscription d'une équipe fantôme par le staff : mêmes
 * contrôles d'état, de doublon et de capacité, même attribution de seed.
 *
 * @param byStaff Inscription faite *à la place* de l'engagé (équipe fantôme,
 *   joueur invité). Le journal Discord la distingue de celle d'un joueur.
 */
async function registerTeam(
  connection: PoolConnection,
  tournamentId: number,
  teamId: number,
  byStaff: boolean,
): Promise<void> {
  // Verrou sur la ligne du tournoi, avant toute lecture de l'effectif.
  //
  // Le plafond se contrôle en comptant les inscriptions puis en insérant : sans
  // verrou, deux inscriptions simultanées lisent le même compte et passent
  // toutes les deux — une place de plus que le maximum, et un plateau qui ne
  // tombe plus juste. L'unicité `(tournament_id, team_id)` protège du doublon,
  // pas du dépassement d'effectif. Le verrou est pris ici, dans le tronc commun,
  // et non chez l'appelant : il vaut pour l'inscription d'un joueur comme pour
  // un lot d'équipes fantômes, et un lot le prend une fois puis le garde.
  //
  // Première écriture de la transaction, donc ordre de verrouillage constant :
  // deux inscriptions concurrentes se sérialisent au lieu de s'interbloquer.
  await connection.execute(`SELECT id FROM bg_tournaments WHERE id = ? FOR UPDATE`, [tournamentId]);

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

  queueBotLog(connection, { kind: "registration", tournamentId, teamId, byStaff });
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

  await registerTeam(connection, tournamentId, teamId, false);
}

/**
 * Erreur d'inscription qui **désigne un engagé** : le lot étant tout ou rien, le
 * refus doit dire lequel a bloqué, faute de quoi le staff n'a plus qu'à
 * recouper sa sélection contre la liste des inscrites.
 *
 * Le code reste porté par `message`, comme partout ailleurs dans le moteur : la
 * route le mappe sur un statut HTTP sans rien savoir de cette propriété, et
 * joint `teamId` au corps quand il y en a un.
 */
export type TeamScopedRegistrationError = Error & { teamId: number };

function teamScopedError(code: string, teamId: number): TeamScopedRegistrationError {
  return Object.assign(new Error(code), { teamId });
}

/**
 * Inscription d'un **lot** d'équipes fantômes par le staff (permission
 * `tournaments`), dans la transaction de l'appelant : ou bien toutes entrent,
 * ou bien aucune n'entre.
 *
 * Le caractère fantôme est relu **ici**, sur la connexion de la transaction, et
 * non par la route : entre l'affichage de la liste et la validation d'un lot il
 * s'écoule le temps de cocher des dizaines de lignes, pendant lequel une
 * fantôme peut être attribuée à un joueur (`claimGhostTeam`) ou dissoute. Une
 * entrée solo est écartée par la même condition — elle naît avec
 * `is_ghost = 0` : le staff n'inscrit jamais un joueur du site à sa place, pas
 * plus qu'une équipe réelle.
 *
 * Les identifiants sont supposés dédoublonnés (`parseGhostBatch`) : deux fois le
 * même buterait sur `ALREADY_REGISTERED` au second passage.
 */
export async function registerTeamsByIds(
  connection: PoolConnection,
  tournamentId: number,
  teamIds: number[],
): Promise<void> {
  if (teamIds.length === 0) throw new Error("EMPTY_TEAM_SELECTION");

  const [teams] = await connection.execute<
    (RowDataPacket & { id: number; is_ghost: 0 | 1; deleted_at: Date | null })[]
  >(
    `SELECT id, is_ghost, deleted_at
     FROM bg_teams
     WHERE id IN (${teamIds.map(() => "?").join(",")})`,
    teamIds,
  );

  const byId = new Map(teams.map((team) => [Number(team.id), team]));
  for (const teamId of teamIds) {
    const team = byId.get(teamId);
    if (!team) throw teamScopedError("TEAM_NOT_FOUND", teamId);
    if (team.deleted_at !== null) throw teamScopedError("TEAM_ALREADY_DELETED", teamId);
    if (team.is_ghost !== 1) throw teamScopedError("NOT_A_GHOST_TEAM", teamId);
  }

  for (const teamId of teamIds) {
    try {
      await registerTeam(connection, tournamentId, teamId, true);
    } catch (error) {
      // `ALREADY_REGISTERED` est le seul refus du tronc commun qui parle d'un
      // engagé précis : le tournoi clos ou complet vaut pour le lot entier, et
      // l'affubler d'un nom laisserait croire que les autres seraient passés.
      if ((error as Error).message === "ALREADY_REGISTERED") {
        throw teamScopedError("ALREADY_REGISTERED", teamId);
      }
      throw error;
    }
  }
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
