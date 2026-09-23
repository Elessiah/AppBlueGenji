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
import { isDuplicateEntryError } from "@/lib/server/mysql-errors";
import { soloEntryNameCandidates } from "@/lib/shared/participants";
import { visibleAvatarUrl } from "@/lib/shared/avatar";

type UserIdentityRow = RowDataPacket & {
  pseudo: string;
  avatar_url: string | null;
  visible_avatar: 0 | 1;
  is_deleted: 0 | 1;
};

/**
 * Logo à recopier sur l'entrée solo.
 *
 * L'entrée solo est affichée partout où l'engagé l'est — plateau, classement,
 * et jusqu'à la **carte du match en direct de l'accueil**, que lit un visiteur
 * sans compte. Recopier l'avatar sans consulter `visible_avatar` publiait donc
 * plus largement que la fiche de profil ne l'aurait jamais fait, et le
 * réglage s'en trouvait entièrement contourné pour qui joue en individuel.
 *
 * Pas d'exception pour le propriétaire, à la différence d'un roster : la valeur
 * est **stockée** puis servie à tout le monde, elle ne peut pas dépendre du
 * lecteur.
 */
function soloEntryLogo(user: UserIdentityRow): string | null {
  return visibleAvatarUrl(user.avatar_url, user.visible_avatar === 1);
}

/**
 * Collision de nom d'entrée solo. Délègue au prédicat partagé
 * (`lib/server/mysql-errors.ts`) : trois lectures du même code d'erreur
 * vivaient dans trois modules, et c'est exactement le genre de détail qui
 * dérive sans qu'aucun test ne le voie.
 */
function isDuplicateNameError(error: unknown): boolean {
  return isDuplicateEntryError(error);
}

/**
 * Identité du joueur, à recopier sur son entrée solo.
 *
 * `lock` fait de la lecture un **verrou** sur la ligne du compte. Il n'est pas
 * décoratif : `bg_teams.solo_user_id` n'a volontairement aucune clé étrangère
 * (une cascade emporterait l'engagé, et avec lui l'historique des matchs), si
 * bien que rien n'empêche la base de créer une entrée solo pour un compte que
 * `deleteOwnAccount` vient d'effacer. Le compte est la ressource que les deux
 * gestes se disputent, et la suppression pose le même verrou : ou bien
 * l'inscription passe la première et la suppression *voit* l'entrée solo (donc
 * anonymise), ou bien la suppression passe la première et l'inscription ne
 * trouve plus de compte **vivant**.
 *
 * « Plus personne » ne se lit **pas** sur la seule absence de ligne : des deux
 * modes de suppression, seul l'*effacement* la fait disparaître, et
 * l'*anonymisation* la laisse en place avec `is_deleted = 1`. La colonne
 * voyage donc avec l'identité, et c'est `ensureSoloEntry` qui la lit — jamais
 * cette fonction, que `syncSoloEntryIdentityOn` appelle légitimement sur une
 * ligne anonymisée, dont le pseudo `compte_supprime_<id>` est précisément ce
 * qu'il faut recopier sur l'entrée solo déjà née.
 *
 * Une lecture verrouillante lit toujours la **dernière version commitée**, là
 * où une lecture ordinaire se contenterait de l'instantané de la transaction.
 */
async function loadUserIdentity(
  connection: PoolConnection,
  userId: number,
  lock = false,
): Promise<UserIdentityRow | null> {
  const [rows] = await connection.execute<UserIdentityRow[]>(
    `SELECT pseudo, avatar_url, visible_avatar, is_deleted
     FROM bg_users
     WHERE id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
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
        soloEntryLogo(user),
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
  // Verrouillant : l'entrée solo qui va naître ne pend à aucune clé étrangère,
  // c'est ce verrou-là qui la tient à une ligne `bg_users` bien vivante.
  //
  // « Vivante » est la condition entière, et l'existence de la ligne n'en dit
  // que la moitié : des deux modes de suppression, seul l'*effacement* la fait
  // disparaître. Sur une **anonymisation** — le mode qu'obtient justement tout
  // compte portant déjà une trace de tournoi —, la ligne reste, et une
  // inscription partie avant la suppression reprend après son commit pour
  // engager `compte_supprime_412` dans un tournoi individuel. Cet engagé-là
  // n'a plus ni session ni identité : personne ne peut plus reporter son
  // score ni l'abandonner, et il faut l'en retirer à la main. Le refus est le
  // même que pour une ligne disparue, parce que c'est le même fait.
  const user = await loadUserIdentity(connection, userId, true);
  if (!user || user.is_deleted === 1) throw new Error("USER_NOT_FOUND");

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
        [name, soloEntryLogo(user), userId],
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

/**
 * Compte joueur derrière une entrée solo, ou `null` si l'identifiant désigne
 * une vraie équipe (ou rien).
 *
 * Une entrée solo occupe une ligne de `bg_teams` mais n'a pas de fiche
 * d'équipe : `/equipes/[id]` s'en sert pour renvoyer sur `/joueurs/[id]` plutôt
 * que d'afficher « Équipe non trouvée » à un lien pourtant valide.
 */
export async function findSoloEntryUser(teamId: number): Promise<number | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { solo_user_id: number | null })[]>(
    `SELECT solo_user_id FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (rows.length === 0 || rows[0].solo_user_id === null) return null;
  return Number(rows[0].solo_user_id);
}
