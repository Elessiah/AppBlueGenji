import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import {
  type BureauMember,
  type BureauMemberInput,
  FALLBACK_BUREAU,
  validateBureauInput,
} from "@/lib/shared/bureau";

export type { BureauMember, BureauMemberInput } from "@/lib/shared/bureau";
export { FALLBACK_BUREAU } from "@/lib/shared/bureau";

interface BureauRow extends RowDataPacket {
  id: number;
  name: string;
  role: string;
  initials: string;
  color: string;
}

function fromRow(row: BureauRow): BureauMember {
  return {
    id: Number(row.id),
    name: row.name,
    role: row.role,
    initials: row.initials,
    color: row.color,
  };
}

/**
 * Liste les membres du bureau triés par ordre d'affichage. Renvoie le bureau
 * de secours si la base ne contient aucune ligne ou est injoignable, afin que
 * la page association reste toujours peuplée.
 */
export async function listBureauMembers(): Promise<BureauMember[]> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<BureauRow[]>(
      `SELECT id, name, role, initials, color
       FROM bg_bureau_members
       ORDER BY display_order ASC, id ASC`,
    );
    if (!rows || rows.length === 0) return FALLBACK_BUREAU;
    return rows.map(fromRow);
  } catch {
    return FALLBACK_BUREAU;
  }
}

/** Crée un membre du bureau et le renvoie. Place le nouveau membre en fin de liste. */
export async function createBureauMember(input: BureauMemberInput): Promise<BureauMember> {
  const validation = validateBureauInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { name, role, initials, color } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_bureau_members (name, role, initials, color, display_order)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), 0) + 10 FROM bg_bureau_members AS m))`,
    [name, role, initials, color],
  );

  return { id: Number(res.insertId), name, role, initials, color };
}

/** Met à jour un membre existant et renvoie sa version mise à jour. */
export async function updateBureauMember(id: number, input: BureauMemberInput): Promise<BureauMember> {
  const validation = validateBureauInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const { name, role, initials, color } = validation.value;

  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_bureau_members
     SET name = ?, role = ?, initials = ?, color = ?
     WHERE id = ?`,
    [name, role, initials, color, id],
  );
  if (res.affectedRows === 0) throw new Error("BUREAU_MEMBER_NOT_FOUND");

  return { id, name, role, initials, color };
}

/** Supprime un membre du bureau. Lève `BUREAU_MEMBER_NOT_FOUND` si l'id n'existe pas. */
export async function deleteBureauMember(id: number): Promise<void> {
  const db = await getDatabase();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM bg_bureau_members WHERE id = ?`,
    [id],
  );
  if (res.affectedRows === 0) throw new Error("BUREAU_MEMBER_NOT_FOUND");
}
