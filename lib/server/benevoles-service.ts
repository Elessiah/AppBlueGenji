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

/** Liste tous les bénévoles triés par catégorie puis par ordre d'affichage. */
export async function listBenevoles(): Promise<Benevole[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<BenevoleRow[]>(
    `SELECT id, first_name, pseudo, last_name, category, photo_url, joined_at
     FROM bg_benevoles
     ORDER BY category ASC, display_order ASC, id ASC`,
  );
  return (rows ?? []).map(fromRow);
}

/** Crée un bénévole et le renvoie. */
export async function createBenevole(input: BenevoleInput): Promise<Benevole> {
  const validation = validateBenevoleInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { firstName, lastName, pseudo, category, photoUrl, joinedAt } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_benevoles (first_name, pseudo, last_name, category, photo_url, joined_at, display_order)
     VALUES (?, ?, ?, ?, ?, ?,
       (SELECT COALESCE(MAX(b2.display_order), 0) + 10 FROM bg_benevoles AS b2 WHERE b2.category = ?))`,
    [firstName, pseudo || null, lastName, category, photoUrl || null, joinedAt, category],
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
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_benevoles
     SET first_name = ?, pseudo = ?, last_name = ?, category = ?, photo_url = ?, joined_at = ?
     WHERE id = ?`,
    [firstName, pseudo || null, lastName, category, photoUrl || null, joinedAt, id],
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

/** Supprime un bénévole. Lève `BENEVOLE_NOT_FOUND` si l'id n'existe pas. */
export async function deleteBenevole(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_benevoles WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("BENEVOLE_NOT_FOUND");
}
