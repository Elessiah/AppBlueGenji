/**
 * Équipes fantômes.
 *
 * Une équipe fantôme est une équipe créée par le staff (permission
 * `tournaments`) pour représenter une formation qui n'a aucun compte joueur sur
 * le site : équipe invitée, équipe qui s'est inscrite hors plateforme, ou
 * simple remplissage de bracket. Elle porte `bg_teams.is_ghost = 1` et n'a
 * **aucun membre** — c'est ce qui la distingue d'une équipe réelle, et ce qui
 * permet au staff de l'administrer sans en être propriétaire (voir
 * `teams-service.ts`, paramètre `viewerManagesGhostTeams`).
 *
 * Cycle de vie : création par le staff → inscription à un tournoi →
 * éventuellement attribution à un joueur réel (`claimGhostTeam`), qui en fait
 * une équipe ordinaire dont il devient OWNER.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { assertTeamTagAvailable, mapTeamTagConflict, resolveTeamTag } from "@/lib/server/team-tags";

export const GHOST_TEAM_NAME_MIN = 3;
export const GHOST_TEAM_NAME_MAX = 60;

/**
 * Crée une équipe fantôme. Contrairement à `createTeam`, aucune ligne
 * `bg_team_members` n'est écrite : personne ne « possède » l'équipe.
 *
 * Le sigle suit exactement la règle des équipes réelles — une fantôme court les
 * mêmes tournois et s'affiche dans les mêmes plateaux, deux sigles identiques
 * s'y confondraient tout autant.
 */
export async function createGhostTeam(
  name: string,
  description?: string | null,
  tag?: string | null,
): Promise<number> {
  const trimmed = name.trim();
  if (trimmed.length < GHOST_TEAM_NAME_MIN || trimmed.length > GHOST_TEAM_NAME_MAX) {
    throw new Error("INVALID_TEAM_NAME");
  }
  const normalizedTag = resolveTeamTag(tag);

  const db = await getDatabase();
  await assertTeamTagAvailable(db, normalizedTag);
  const [insert] = await mapTeamTagConflict(() =>
    db.execute<ResultSetHeader>(
      `INSERT INTO bg_teams (name, tag, logo_url, description, is_ghost)
       VALUES (?, ?, NULL, ?, 1)`,
      [trimmed, normalizedTag, description?.trim() ? description.trim() : null],
    ));

  return Number(insert.insertId);
}

/**
 * Attribue une équipe fantôme à un joueur réel : il en devient OWNER et
 * l'équipe redevient une équipe ordinaire (`is_ghost = 0`). L'historique
 * (inscriptions, matchs, classements) est conservé tel quel.
 *
 * Refus : équipe inconnue, déjà réelle, dissoute, ou joueur déjà engagé dans
 * une autre équipe (invariant « un joueur = une seule équipe active »).
 */
export async function claimGhostTeam(teamId: number, newOwnerUserId: number): Promise<void> {
  const db = await getDatabase();

  const [teams] = await db.execute<(RowDataPacket & { is_ghost: 0 | 1; deleted_at: Date | null })[]>(
    `SELECT is_ghost, deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0) throw new Error("TEAM_NOT_FOUND");
  if (teams[0].deleted_at !== null) throw new Error("TEAM_ALREADY_DELETED");
  if (teams[0].is_ghost !== 1) throw new Error("NOT_A_GHOST_TEAM");

  const [users] = await db.execute<(RowDataPacket & { id: number })[]>(
    // `bg_users` marque l'anonymisation avec `is_deleted` (pas `deleted_at`,
    // qui n'existe que sur `bg_teams`) : un compte anonymisé ne peut pas
    // récupérer une équipe fantôme.
    `SELECT id FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [newOwnerUserId],
  );
  if (users.length === 0) throw new Error("USER_NOT_FOUND");

  const [existingMembership] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL LIMIT 1`,
    [newOwnerUserId],
  );
  if (existingMembership.length > 0) throw new Error("USER_ALREADY_IN_TEAM");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO bg_team_members (team_id, user_id, roles_json)
       VALUES (?, ?, ?)`,
      [teamId, newOwnerUserId, JSON.stringify(["OWNER"])],
    );

    await connection.execute(`UPDATE bg_teams SET is_ghost = 0 WHERE id = ?`, [teamId]);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Équipes fantômes encore actives, pour les sélecteurs d'administration
 * (inscription à un tournoi). Triées par nom.
 *
 * @param excludeTournamentId Tournoi dont les engagées sont retirées de la
 *   liste. Une équipe déjà inscrite n'a rien à faire dans un sélecteur
 *   d'inscription : la reproposer ne pouvait mener qu'à un `ALREADY_REGISTERED`
 *   après l'aller-retour, et sur un lot elle ferait échouer toute la sélection.
 *   Le filtre est posé **en base** et non côté client : la liste est relue à
 *   chaque ouverture du dialogue, elle doit refléter les inscriptions arrivées
 *   entre-temps.
 *
 *   Le `solo_user_id IS NULL` est redondant avec `is_ghost = 1` (une entrée solo
 *   naît avec `is_ghost = 0`) mais tenu par convention du projet : on ne liste
 *   jamais `bg_teams` sans écarter les entrées solo, qui ne sont pas des
 *   équipes.
 */
export async function listGhostTeams(
  excludeTournamentId?: number,
): Promise<{ id: number; name: string; logoUrl: string | null }[]> {
  const db = await getDatabase();
  const exclusion =
    excludeTournamentId === undefined
      ? ""
      : `AND NOT EXISTS (
           SELECT 1 FROM bg_tournament_registrations r
           WHERE r.tournament_id = ? AND r.team_id = bg_teams.id
         )`;

  const [rows] = await db.execute<(RowDataPacket & { id: number; name: string; logo_url: string | null })[]>(
    `SELECT id, name, logo_url
     FROM bg_teams
     WHERE is_ghost = 1 AND deleted_at IS NULL AND solo_user_id IS NULL
     ${exclusion}
     ORDER BY name ASC`,
    excludeTournamentId === undefined ? [] : [excludeTournamentId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    logoUrl: row.logo_url,
  }));
}
