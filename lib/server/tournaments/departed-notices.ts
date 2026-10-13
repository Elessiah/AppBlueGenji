/**
 * Avis aux engagées **retirées** d'une manche par une correction de score
 * (`./scoring.ts` `pushTeamToTarget`, `./bracket-cascade.ts`) : l'horaire
 * qu'elles avaient reçu ne les concerne plus.
 *
 * L'horaire tenu se lit dans la transaction de la correction, **avant** que les
 * marques de la manche ne soient effacées (`forgetMatchReminders`) ; l'avis part
 * après le commit, comme les lignes du journal (`flushBotLogs`), et se jette
 * avec elles si la transaction échoue (`discardBotLogs`).
 *
 * Rien ne part si les joueurs n'avaient reçu aucun horaire (pas de marque
 * `TOLD`, ou plus d'horaire après un retrait remis), ni pour un horaire passé
 * depuis plus de 12 h.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { MATCH_TOLD_KEY } from "@/lib/shared/discord-notifications";
import { announceEntrantWithdrawn, type DepartedEntrant } from "./match-reminders";
import { HELD_TIME_GRACE_MS } from "./reminder-marks";

/** Avis en attente, par connexion (même cycle de vie que la file du journal). */
const pending = new WeakMap<PoolConnection, DepartedEntrant[]>();

type HeldRow = RowDataPacket & { start_at: Date | string | null };

/**
 * Note qu'une engagée quitte une manche : si ses joueurs tiennent un horaire
 * encore valable, un avis partira après le commit. À appeler **avant**
 * l'effacement des marques de la manche.
 *
 * @param slot La place que l'engagée occupait (1 ou 2).
 */
export async function noteDepartedEntrant(
  connection: PoolConnection,
  matchId: number,
  teamId: number,
  slot: 1 | 2,
): Promise<void> {
  let rows: HeldRow[];
  try {
    [rows] = await connection.execute<HeldRow[]>(
      `SELECT start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1`,
      [matchId, MATCH_TOLD_KEY],
    );
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }
  const held = rows[0]?.start_at ?? null;
  if (held === null) return;
  if (new Date(held).getTime() <= Date.now() - HELD_TIME_GRACE_MS) return;
  const notice: DepartedEntrant = { matchId, teamId, slot, heldStartAt: held };
  const queue = pending.get(connection);
  if (queue) queue.push(notice);
  else pending.set(connection, [notice]);
}

/** Jette les avis notés : la correction n'a pas abouti. */
export function discardDepartedNotices(connection: PoolConnection): void {
  pending.delete(connection);
}

/**
 * Envoie les avis notés par la transaction qui vient d'aboutir, **sans
 * attendre** (comme `flushBotLogs`). Ne lève jamais.
 */
export function flushDepartedNotices(connection: PoolConnection): void {
  const notices = pending.get(connection) ?? [];
  pending.delete(connection);
  for (const notice of notices) {
    void announceEntrantWithdrawn(notice).catch((error: unknown) => {
      if (!isMissingTableError(error)) console.error("[notify] avis de match retiré non envoyé", error);
    });
  }
}
