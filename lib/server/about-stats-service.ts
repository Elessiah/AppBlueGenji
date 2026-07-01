import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  type AboutStat,
  type AboutStatInput,
  FALLBACK_ABOUT_STATS,
  validateAboutStatInput,
} from "@/lib/shared/about-stats";

export type { AboutStat, AboutStatInput } from "@/lib/shared/about-stats";
export { FALLBACK_ABOUT_STATS } from "@/lib/shared/about-stats";

interface AboutStatRow extends RowDataPacket {
  id: number;
  value: string;
  label: string;
}

function fromRow(row: AboutStatRow): AboutStat {
  return { id: Number(row.id), value: row.value, label: row.label };
}

/**
 * Liste les cartes « L'association » triées par ordre d'affichage. Renvoie les
 * cartes de secours si la base ne contient aucune ligne ou est injoignable, afin
 * que la section reste toujours peuplée.
 */
export async function listAboutStats(): Promise<AboutStat[]> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<AboutStatRow[]>(
      `SELECT id, value, label
       FROM bg_about_stats
       ORDER BY display_order ASC, id ASC`,
    );
    if (!rows || rows.length === 0) return FALLBACK_ABOUT_STATS;
    return rows.map(fromRow);
  } catch {
    return FALLBACK_ABOUT_STATS;
  }
}

/** Crée une carte et la renvoie. Place la nouvelle carte en fin de liste. */
export async function createAboutStat(input: AboutStatInput): Promise<AboutStat> {
  const validation = validateAboutStatInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { value, label } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_about_stats (value, label, display_order)
     VALUES (?, ?, (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_about_stats AS s))`,
    [value, label],
  );

  return { id: Number(res.insertId), value, label };
}

/** Met à jour une carte existante et renvoie sa version mise à jour. */
export async function updateAboutStat(id: number, input: AboutStatInput): Promise<AboutStat> {
  const validation = validateAboutStatInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { value, label } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_about_stats SET value = ?, label = ? WHERE id = ?`,
    [value, label, id],
  );
  if (res.affectedRows === 0) throw new Error("ABOUT_STAT_NOT_FOUND");

  return { id, value, label };
}

/** Supprime une carte. Lève `ABOUT_STAT_NOT_FOUND` si l'id n'existe pas. */
export async function deleteAboutStat(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_about_stats WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("ABOUT_STAT_NOT_FOUND");
}
