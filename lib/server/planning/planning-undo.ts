/**
 * Annulation d'un geste manuel du planning dont la désignation sur le match
 * n'a pas pris (`docs/features/CAST_PLANNING.md` § Gestes). Le geste écrit
 * d'abord ses lignes du planning (une transaction, validée), puis passe par la
 * désignation du match (`assignMatchReferee`, sa propre transaction) ; si
 * celle-ci est refusée ou tombe en panne sans avoir pris, les **seules** lignes
 * que le geste a écrites ou retirées sont remises telles qu'elles étaient, et
 * les évènements du geste effacés. Le match n'est jamais réécrit à la main : il
 * ne change que par sa désignation, avec ses contrôles et ses avis.
 *
 * Seules ces lignes se remettent, sous le verrou nommé du planning que tient le
 * geste : aucun autre geste du planning ne les a touchées entre-temps. Une
 * ligne d'un compte supprimé depuis (`is_deleted`) ne revient pas, et le staff
 * qui l'avait posée n'est plus nommé s'il a été supprimé : l'effacement d'un
 * compte joué entre-temps n'est pas défait.
 */
import type { RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { failureDiagnostic } from "@/lib/server/failure-reason";
import { transact } from "@/lib/server/tournaments/transaction";
import type { Executor } from "./load";
import { isMatchRefereeRefusal } from "./auto-assign";

/** Une ligne `bg_planning_assignments`, entière, telle qu'avant le geste. */
export type PlanningAssignmentRow = {
  entry_key: string;
  user_id: number;
  role: string;
  tournament_id: number;
  match_id: number | null;
  source: string;
  reason: string;
  confirmed: number;
  assigned_by_user_id: number | null;
  created_at: Date;
};

/** La clé d'une ligne d'attribution (entrée, membre, rôle). */
export type AssignmentKey = { entryKey: string; userId: number; role: string };

/** Ce qu'un geste touche : ses clés, et les lignes qu'elles portaient avant lui. */
export type PlanningUndo = { keys: AssignmentKey[]; rows: PlanningAssignmentRow[] };

export async function readPlanningRows(executor: Executor, entryKeys: readonly string[]): Promise<PlanningAssignmentRow[]> {
  const keys = [...new Set(entryKeys)];
  if (keys.length === 0) return [];
  const [rows] = await executor.execute<(RowDataPacket & PlanningAssignmentRow)[]>(
    `SELECT entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id, created_at
       FROM bg_planning_assignments WHERE entry_key IN (${keys.map(() => "?").join(", ")})`,
    keys,
  );
  return rows;
}

function sameKey(row: PlanningAssignmentRow, key: AssignmentKey): boolean {
  return row.entry_key === key.entryKey && Number(row.user_id) === key.userId && row.role === key.role;
}

/**
 * L'instantané d'un geste : la ligne qu'il écrit (`written`) et celles qu'il
 * retire (`removes`), lues sur les entrées `entryKeys` avant lui.
 */
export async function snapshotGesture(
  executor: Executor,
  entryKeys: readonly string[],
  written: AssignmentKey,
  removes: (row: PlanningAssignmentRow) => boolean = () => false,
): Promise<PlanningUndo> {
  const rows = (await readPlanningRows(executor, entryKeys)).filter((row) => sameKey(row, written) || removes(row));
  const keys = [written];
  for (const row of rows) {
    if (!keys.some((key) => sameKey(row, key))) keys.push({ entryKey: row.entry_key, userId: Number(row.user_id), role: row.role });
  }
  return { keys, rows };
}

/** L'arbitre que porte le match maintenant ; `undefined` si la lecture échoue ou si le match n'existe plus. */
export async function readMatchReferee(matchId: number): Promise<number | null | undefined> {
  try {
    return await withConnection(async (connection) => {
      const [rows] = await connection.execute<(RowDataPacket & { referee_user_id: number | null })[]>(
        "SELECT referee_user_id FROM bg_matches WHERE id = ?",
        [matchId],
      );
      if (rows.length === 0) return undefined;
      return rows[0].referee_user_id === null ? null : Number(rows[0].referee_user_id);
    });
  } catch {
    return undefined;
  }
}

/**
 * La désignation a-t-elle pris malgré l'erreur ? Un refus du match
 * (`MATCH_REFEREE_REFUSAL_CODES`) n'a rien validé ; une panne peut survenir
 * après la validation : le match relu le dit (son arbitre est `wanted`). Le
 * geste ne passe par le match que si celui-ci n'avait pas déjà `wanted` juste
 * avant (`readMatchReferee`) : un match relu à `wanted` vient donc de lui (ou
 * d'une désignation concurrente du même compte, qui dit la même chose).
 * Illisible : on ne sait pas — rien n'est remis, c'est consigné.
 */
export async function designationTookEffect(error: unknown, matchId: number, wanted: number | null): Promise<boolean | undefined> {
  if (isMatchRefereeRefusal(error)) return false;
  const now = await readMatchReferee(matchId);
  if (now === undefined) return undefined;
  return now === wanted;
}

/** Remet une ligne, sauf pour un compte supprimé depuis ; le staff qui l'avait posée n'est renommé que s'il existe encore. */
const RESTORE_ROW_SQL = `INSERT IGNORE INTO bg_planning_assignments
    (entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id, created_at)
  SELECT ?, u.id, ?, ?, ?, ?, ?, ?, (SELECT b.id FROM bg_users b WHERE b.id = ? AND b.is_deleted = 0), ?
    FROM bg_users u WHERE u.id = ? AND u.is_deleted = 0`;

/**
 * Remet les lignes de `undo` (ses seules clés) et efface les évènements
 * `eventIds` du geste, d'un bloc, sur une connexion neuve (celle du geste a pu
 * être détruite par un retour arrière manqué). N'échoue jamais : l'erreur
 * d'origine reste celle qui remonte ; un échec ici est consigné (pm2).
 */
export async function undoPlanningBlock(undo: PlanningUndo, eventIds: readonly number[]): Promise<boolean> {
  try {
    await withConnection((connection) =>
      transact(connection, async () => {
        for (const key of undo.keys) {
          await connection.execute("DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ?", [
            key.entryKey,
            key.userId,
            key.role,
          ]);
        }
        for (const row of undo.rows) {
          await connection.execute(RESTORE_ROW_SQL, [
            row.entry_key,
            row.role,
            row.tournament_id,
            row.match_id,
            row.source,
            row.reason,
            row.confirmed,
            row.assigned_by_user_id,
            row.created_at,
            row.user_id,
          ]);
        }
        if (eventIds.length > 0) {
          await connection.execute(`DELETE FROM bg_planning_events WHERE id IN (${eventIds.map(() => "?").join(", ")})`, [
            ...eventIds,
          ]);
        }
      }),
    );
    return true;
  } catch (error) {
    const where = [...new Set(undo.keys.map((key) => key.entryKey))].join(", ");
    console.error(`[planning] geste manuel non annulé sur ${where} après l'échec de la désignation du match`, failureDiagnostic(error));
    return false;
  }
}

/**
 * Après l'échec de la désignation du match : remet le planning si elle n'a
 * pas pris ; la garde si elle a pris (le planning dit vrai) ; consigne le
 * doute. Une ligne d'arbitre confirmée que le match ne porte pas, laissée par
 * ce doute, est retirée au prochain calcul, à la prochaine confirmation ou au
 * prochain geste manuel (`confirmPendingReferees`).
 */
export async function settleFailedDesignation(
  error: unknown,
  matchId: number,
  wanted: number | null,
  undo: PlanningUndo,
  eventIds: readonly number[],
): Promise<void> {
  const took = await designationTookEffect(error, matchId, wanted);
  if (took === true) return;
  if (took === undefined) {
    console.error(`[planning] désignation du match ${matchId} incertaine après une panne : planning gardé tel quel.`);
    return;
  }
  await undoPlanningBlock(undo, eventIds);
}
