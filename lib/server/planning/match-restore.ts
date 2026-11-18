/**
 * Remise en l'état de l'arbitrage d'un match quand un geste du planning échoue
 * **après** que la désignation du match (`assignMatchReferee`, sa propre
 * transaction) a été validée (`docs/features/CAST_PLANNING.md` § Gestes) :
 * planning et match ne se contredisent pas.
 *
 * L'état d'avant est lu en entier — arbitre, autogestion, « prêt » de
 * l'arbitre — et remis d'**une** instruction, à condition que le match soit
 * encore dans l'état que le geste a posé (même arbitre, même statut) : un
 * autre geste passé entre-temps, ou un match parti au lancement, n'est jamais
 * écrasé. Ce qui ne se remet pas est consigné (pm2), jamais tu.
 */
import type { RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { failureDiagnostic } from "@/lib/server/failure-reason";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import type { Executor } from "./load";

/** L'arbitrage d'un match tel que le geste l'a trouvé. */
export type MatchRefereeSnapshot = {
  matchId: number;
  tournamentId: number;
  refereeId: number | null;
  refereeReadyAt: Date | null;
  selfManaged: boolean;
  status: string;
};

type SnapshotRow = RowDataPacket & {
  tournament_id: number;
  referee_user_id: number | null;
  referee_ready_at: Date | null;
  self_managed: number | null;
  status: string;
};

/** Lit l'arbitrage du match avant le geste ; `null` si le match n'existe plus. */
export async function readMatchReferee(executor: Executor, matchId: number): Promise<MatchRefereeSnapshot | null> {
  const [rows] = await executor.execute<SnapshotRow[]>(
    "SELECT tournament_id, referee_user_id, referee_ready_at, self_managed, status FROM bg_matches WHERE id = ?",
    [matchId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    matchId,
    tournamentId: Number(row.tournament_id),
    refereeId: row.referee_user_id === null ? null : Number(row.referee_user_id),
    refereeReadyAt: row.referee_ready_at ?? null,
    selfManaged: Number(row.self_managed ?? 0) === 1,
    status: String(row.status),
  };
}

/**
 * Remet `snapshot` sur le match si son arbitre est encore `written` (celui que
 * le geste a posé, `null` pour un retrait) et son statut celui d'avant. Sans
 * effet si la désignation n'avait rien validé. Rend `true` si le match est
 * (ou était resté) dans l'état d'avant. N'échoue jamais : l'erreur d'origine
 * du geste reste celle qui remonte.
 */
export async function restoreMatchReferee(snapshot: MatchRefereeSnapshot, written: number | null): Promise<boolean> {
  if (snapshot.refereeId === written) return true;
  try {
    const restored = await withConnection(async (connection) => {
      const [result] = await connection.execute(
        `UPDATE bg_matches SET referee_user_id = ?, referee_ready_at = ?, self_managed = ?
          WHERE id = ? AND referee_user_id <=> ? AND status = ?`,
        [snapshot.refereeId, snapshot.refereeReadyAt, snapshot.selfManaged ? 1 : 0, snapshot.matchId, written, snapshot.status],
      );
      if (Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0) return "RESTORED" as const;
      // Rien remis : ou bien la désignation n'avait rien validé (le match a
      // encore son arbitrage d'avant), ou bien un autre geste est passé.
      const now = await readMatchReferee(connection, snapshot.matchId);
      return now !== null && now.refereeId === snapshot.refereeId && now.selfManaged === snapshot.selfManaged
        ? ("UNCHANGED" as const)
        : ("MOVED" as const);
    });
    if (restored === "RESTORED") publishMatchUpdatedEvent(snapshot.tournamentId);
    if (restored === "MOVED") {
      console.error(`[planning] arbitrage du match ${snapshot.matchId} non remis après un échec : le match a changé entre-temps.`);
    }
    return restored !== "MOVED";
  } catch (error) {
    console.error(`[planning] arbitrage du match ${snapshot.matchId} non remis après un échec`, failureDiagnostic(error));
    return false;
  }
}
