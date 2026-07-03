import { getDatabase } from "./database";

/**
 * Réécrit la colonne `display_order` d'une table selon l'ordre fourni : le
 * premier id reçoit 10, le suivant 20, etc. L'opération est atomique (une
 * transaction) afin qu'un échec en cours de route ne laisse pas un ordre
 * incohérent. Le nom de table n'est jamais dérivé d'une entrée utilisateur —
 * chaque appelant le code en dur —, l'interpolation est donc sûre.
 */
export async function applyDisplayOrder(table: string, ids: number[]): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (let i = 0; i < ids.length; i += 1) {
      await connection.execute(
        `UPDATE ${table} SET display_order = ? WHERE id = ?`,
        [(i + 1) * 10, ids[i]],
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
