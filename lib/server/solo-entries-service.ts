/**
 * Entrées solo.
 *
 * Un **tournoi individuel** (`bg_tournaments.participant_type = 'SOLO'`) fait
 * s'inscrire les joueurs eux-mêmes. Le moteur de tournoi, lui, ne sait manier
 * que des engagés identifiés par un `team_id` : plateaux, survie, ronde suisse,
 * endurance et multi-phases pointent tous vers `bg_teams`. Plutôt que de
 * dupliquer ce modèle, un joueur qui s'inscrit à un tournoi individuel reçoit
 * une **entrée solo** — une ligne `bg_teams` qui le représente, portant
 * `solo_user_id` et **aucun membre** (même principe que les équipes fantômes).
 *
 * Conséquences voulues :
 * - tous les formats fonctionnent sans modification ;
 * - l'entrée solo garde son historique de matchs d'un tournoi à l'autre ;
 * - elle n'est **pas** une équipe : elle est exclue de `/equipes`, du
 *   classement du site et des statistiques d'équipes, et sa fiche renvoie vers
 *   le profil du joueur.
 *
 * L'identité affichée (nom, logo) est recopiée depuis le compte à chaque
 * inscription et à chaque mise à jour de profil, pour qu'un changement de
 * pseudo ou d'avatar se reflète dans les brackets.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { soloEntryNameCandidates } from "@/lib/shared/participants";

type UserIdentityRow = RowDataPacket & {
  pseudo: string;
  avatar_url: string | null;
};

function isDuplicateNameError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ER_DUP_ENTRY";
}

async function loadUserIdentity(
  connection: PoolConnection,
  userId: number,
): Promise<UserIdentityRow | null> {
  const [rows] = await connection.execute<UserIdentityRow[]>(
    `SELECT pseudo, avatar_url FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return rows.length === 0 ? null : rows[0];
}

/** Identifiant de l'entrée solo d'un joueur, sans la créer. */
export async function findSoloEntry(
  connection: PoolConnection,
  userId: number,
): Promise<number | null> {
  const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_teams WHERE solo_user_id = ? LIMIT 1`,
    [userId],
  );
  return rows.length === 0 ? null : Number(rows[0].id);
}

/**
 * Recopie pseudo et avatar sur l'entrée solo. Le nom d'équipe étant unique, on
 * essaie les candidats dans l'ordre ; si aucun ne passe, l'entrée garde son nom
 * précédent plutôt que de faire échouer l'appelant.
 */
async function applyIdentity(
  connection: PoolConnection,
  entryId: number,
  user: UserIdentityRow,
  userId: number,
): Promise<void> {
  for (const name of soloEntryNameCandidates(user.pseudo, userId)) {
    try {
      await connection.execute(`UPDATE bg_teams SET name = ?, logo_url = ? WHERE id = ?`, [
        name,
        user.avatar_url,
        entryId,
      ]);
      return;
    } catch (error) {
      if (!isDuplicateNameError(error)) throw error;
    }
  }
}

/**
 * Entrée solo du joueur, créée à la volée si elle n'existe pas encore, et dont
 * l'identité affichée est resynchronisée depuis le compte.
 *
 * Le nom d'une équipe est unique en base : on essaie les candidats de
 * `soloEntryNameCandidates` dans l'ordre (pseudo, pseudo suffixé, « Joueur
 * #id ») jusqu'à ce que l'insertion passe.
 *
 * @throws USER_NOT_FOUND | SOLO_ENTRY_NAME_UNAVAILABLE
 */
export async function ensureSoloEntry(
  connection: PoolConnection,
  userId: number,
): Promise<number> {
  const user = await loadUserIdentity(connection, userId);
  if (!user) throw new Error("USER_NOT_FOUND");

  const existing = await findSoloEntry(connection, userId);
  if (existing !== null) {
    await applyIdentity(connection, existing, user, userId);
    return existing;
  }

  for (const name of soloEntryNameCandidates(user.pseudo, userId)) {
    try {
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, logo_url, description, is_ghost, solo_user_id)
         VALUES (?, ?, NULL, 0, ?)`,
        [name, user.avatar_url, userId],
      );
      return Number(insert.insertId);
    } catch (error) {
      if (!isDuplicateNameError(error)) throw error;
      // Nom déjà pris : on tente le candidat suivant. Une course entre deux
      // inscriptions simultanées du même joueur bute, elle, sur l'unicité de
      // `solo_user_id` — on relit alors l'entrée gagnante.
      const raced = await findSoloEntry(connection, userId);
      if (raced !== null) return raced;
    }
  }

  throw new Error("SOLO_ENTRY_NAME_UNAVAILABLE");
}

/** Resynchronise l'identité affichée de l'entrée solo, si le joueur en a une. */
export async function syncSoloEntryIdentityOn(
  connection: PoolConnection,
  userId: number,
): Promise<void> {
  const entryId = await findSoloEntry(connection, userId);
  if (entryId === null) return;

  const user = await loadUserIdentity(connection, userId);
  if (!user) return;

  await applyIdentity(connection, entryId, user, userId);
}

/** Même synchronisation, hors transaction (mise à jour de profil). */
export async function syncSoloEntryIdentity(userId: number): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await syncSoloEntryIdentityOn(connection, userId);
  } finally {
    connection.release();
  }
}

/**
 * Comptes joueurs derrière une liste d'engagés : `team_id → user_id`, limité
 * aux entrées solo. Sert à faire pointer brackets et classements vers le profil
 * du joueur plutôt que vers une fiche d'équipe.
 */
export async function loadSoloUserIds(
  connection: PoolConnection,
  teamIds: number[],
): Promise<Record<number, number>> {
  if (teamIds.length === 0) return {};

  const [rows] = await connection.execute<(RowDataPacket & { id: number; solo_user_id: number })[]>(
    `SELECT id, solo_user_id
     FROM bg_teams
     WHERE solo_user_id IS NOT NULL
       AND id IN (${teamIds.map(() => "?").join(",")})`,
    teamIds,
  );

  const map: Record<number, number> = {};
  for (const row of rows) {
    map[Number(row.id)] = Number(row.solo_user_id);
  }
  return map;
}
