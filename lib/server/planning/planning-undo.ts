/**
 * Annulation d'un geste manuel du planning dont la désignation sur le match
 * n'a pas pris (`docs/features/CAST_PLANNING.md` § Gestes). Le geste écrit
 * d'abord ses lignes du planning (une transaction, validée), puis passe par la
 * désignation du match (`assignMatchReferee`, sa propre transaction) ; si
 * celle-ci est refusée ou tombe en panne sans avoir pris, les lignes des
 * entrées touchées sont remises telles qu'elles étaient et les évènements du
 * geste effacés. Le match n'est jamais réécrit à la main : il ne change que par
 * sa désignation, avec ses contrôles et ses avis.
 *
 * Seules les lignes du planning se remettent, sous le verrou nommé du
 * planning que tient le geste : aucun autre geste du planning ne les a
 * touchées entre-temps. Une ligne d'un compte supprimé depuis ne revient pas
 * (`INSERT IGNORE` : la clé étrangère la refuse).
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

/** Les lignes du planning des entrées qu'un geste va toucher, telles qu'avant lui. */
export type PlanningRowsSnapshot = { entryKeys: string[]; rows: PlanningAssignmentRow[] };

export async function readPlanningRows(executor: Executor, entryKeys: readonly string[]): Promise<PlanningRowsSnapshot> {
  const keys = [...new Set(entryKeys)];
  if (keys.length === 0) return { entryKeys: [], rows: [] };
  const [rows] = await executor.execute<(RowDataPacket & PlanningAssignmentRow)[]>(
    `SELECT entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id, created_at
       FROM bg_planning_assignments WHERE entry_key IN (${keys.map(() => "?").join(", ")})`,
    keys,
  );
  return { entryKeys: keys, rows };
}

/** L'arbitre que porte le match maintenant ; `undefined` si la lecture échoue ou si le match n'existe plus. */
async function currentMatchReferee(matchId: number): Promise<number | null | undefined> {
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
 * après la validation : le match relu le dit (son arbitre est `wanted`).
 * Illisible : on ne sait pas — rien n'est remis, c'est consigné.
 */
export async function designationTookEffect(error: unknown, matchId: number, wanted: number | null): Promise<boolean | undefined> {
  if (isMatchRefereeRefusal(error)) return false;
  const now = await currentMatchReferee(matchId);
  if (now === undefined) return undefined;
  return now === wanted;
}

/**
 * Remet les lignes de `snapshot` et efface les évènements `eventIds` du geste,
 * d'un bloc, sur une connexion neuve (celle du geste a pu être détruite par un
 * retour arrière manqué). N'échoue jamais : l'erreur d'origine reste celle qui
 * remonte ; un échec ici est consigné (pm2).
 */
export async function undoPlanningBlock(snapshot: PlanningRowsSnapshot, eventIds: readonly number[]): Promise<boolean> {
  try {
    await withConnection((connection) =>
      transact(connection, async () => {
        if (snapshot.entryKeys.length > 0) {
          await connection.execute(
            `DELETE FROM bg_planning_assignments WHERE entry_key IN (${snapshot.entryKeys.map(() => "?").join(", ")})`,
            snapshot.entryKeys,
          );
        }
        for (const row of snapshot.rows) {
          await connection.execute(
            `INSERT IGNORE INTO bg_planning_assignments
               (entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.entry_key,
              row.user_id,
              row.role,
              row.tournament_id,
              row.match_id,
              row.source,
              row.reason,
              row.confirmed,
              row.assigned_by_user_id,
              row.created_at,
            ],
          );
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
    console.error(
      `[planning] geste manuel non annulé sur ${snapshot.entryKeys.join(", ")} après l'échec de la désignation du match`,
      failureDiagnostic(error),
    );
    return false;
  }
}

/**
 * Après l'échec de la désignation du match : remet le planning si elle n'a
 * pas pris ; la garde si elle a pris (le planning dit vrai) ; consigne le doute.
 */
export async function settleFailedDesignation(
  error: unknown,
  matchId: number,
  wanted: number | null,
  snapshot: PlanningRowsSnapshot,
  eventIds: readonly number[],
): Promise<void> {
  const took = await designationTookEffect(error, matchId, wanted);
  if (took === true) return;
  if (took === undefined) {
    console.error(`[planning] désignation du match ${matchId} incertaine après une panne : planning gardé tel quel.`);
    return;
  }
  await undoPlanningBlock(snapshot, eventIds);
}
