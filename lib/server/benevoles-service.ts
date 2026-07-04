import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  type Benevole,
  type BenevoleInput,
  validateBenevoleInput,
} from "@/lib/shared/benevoles";

export type { Benevole, BenevoleInput } from "@/lib/shared/benevoles";

interface BenevoleRow extends RowDataPacket {
  id: number;
  first_name: string;
  pseudo: string | null;
  last_name: string;
  category: string;
  photo_url: string | null;
  joined_at: string;
}

function fromRow(row: BenevoleRow): Benevole {
  return {
    id: Number(row.id),
    firstName: row.first_name,
    pseudo: row.pseudo || null,
    lastName: row.last_name,
    category: row.category,
    photoUrl: row.photo_url || null,
    joinedAt: typeof row.joined_at === "string"
      ? row.joined_at.slice(0, 10)
      : new Date(row.joined_at).toISOString().slice(0, 10),
  };
}

/** Liste tous les bénévoles triés par ordre de catégorie puis d'affichage. Retourne [] si la DB est injoignable. */
export async function listBenevoles(): Promise<Benevole[]> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<BenevoleRow[]>(
      `SELECT id, first_name, pseudo, last_name, category, photo_url, joined_at
       FROM bg_benevoles
       ORDER BY category_order ASC, category ASC, display_order ASC, id ASC`,
    );
    return (rows ?? []).map(fromRow);
  } catch {
    return [];
  }
}

/**
 * Renvoie l'ordre à attribuer à une catégorie : celui d'une catégorie existante
 * de même nom (pour rester groupé au même endroit), sinon `MAX + 10` afin de la
 * placer en fin de liste des catégories.
 */
async function resolveCategoryOrder(category: string): Promise<number> {
  const db = await getDatabase();
  const [existing] = await db.execute<(RowDataPacket & { category_order: number })[]>(
    `SELECT category_order FROM bg_benevoles WHERE category = ? LIMIT 1`,
    [category],
  );
  if (existing.length > 0) return Number(existing[0].category_order);

  const [max] = await db.execute<(RowDataPacket & { next: number })[]>(
    `SELECT COALESCE(MAX(category_order), 0) + 10 AS next FROM bg_benevoles`,
  );
  return Number(max[0].next);
}

/** Renvoie l'URL de la photo d'un bénévole (ou `null`), pour le nettoyage de fichier. */
export async function getBenevolePhotoUrl(id: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<BenevoleRow[]>(
    `SELECT photo_url FROM bg_benevoles WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? rows[0].photo_url || null : null;
}

/** Crée un bénévole et le renvoie. */
export async function createBenevole(input: BenevoleInput): Promise<Benevole> {
  const validation = validateBenevoleInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { firstName, lastName, pseudo, category, photoUrl, joinedAt } = validation.value;

  const db = await getDatabase();
  const categoryOrder = await resolveCategoryOrder(category);
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_benevoles (first_name, pseudo, last_name, category, photo_url, joined_at, category_order, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?,
       (SELECT COALESCE(MAX(b2.display_order), 0) + 10 FROM bg_benevoles AS b2 WHERE b2.category = ?))`,
    [firstName, pseudo || null, lastName, category, photoUrl || null, joinedAt, categoryOrder, category],
  );

  return {
    id: Number(res.insertId),
    firstName,
    pseudo: pseudo || null,
    lastName,
    category,
    photoUrl: photoUrl || null,
    joinedAt,
  };
}

/** Met à jour un bénévole existant. */
export async function updateBenevole(id: number, input: BenevoleInput): Promise<Benevole> {
  const validation = validateBenevoleInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { firstName, lastName, pseudo, category, photoUrl, joinedAt } = validation.value;

  const db = await getDatabase();
  // Aligne l'ordre de catégorie sur la (nouvelle) catégorie : conserve sa place
  // si elle existe déjà, ou l'ajoute en fin de liste si c'est un nouveau nom.
  const categoryOrder = await resolveCategoryOrder(category);
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_benevoles
     SET first_name = ?, pseudo = ?, last_name = ?, category = ?, photo_url = ?, joined_at = ?, category_order = ?
     WHERE id = ?`,
    [firstName, pseudo || null, lastName, category, photoUrl || null, joinedAt, categoryOrder, id],
  );
  if (res.affectedRows === 0) throw new Error("BENEVOLE_NOT_FOUND");

  return {
    id,
    firstName,
    pseudo: pseudo || null,
    lastName,
    category,
    photoUrl: photoUrl || null,
    joinedAt,
  };
}

/**
 * Réordonne les catégories de bénévoles selon la liste de noms fournie (premier
 * = affiché en tête). Réécrit `category_order` de toutes les lignes de chaque
 * catégorie de façon atomique.
 */
export async function reorderBenevoleCategories(categories: string[]): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (let i = 0; i < categories.length; i += 1) {
      await connection.execute(
        `UPDATE bg_benevoles SET category_order = ? WHERE category = ?`,
        [(i + 1) * 10, categories[i]],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Supprime un bénévole. Lève `BENEVOLE_NOT_FOUND` si l'id n'existe pas. */
export async function deleteBenevole(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_benevoles WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("BENEVOLE_NOT_FOUND");
}
