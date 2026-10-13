/**
 * Avis aux engagées **retirées** d'une manche par une correction de score
 * (`./scoring.ts` `pushTeamToTarget`, `./bracket-cascade.ts`) : l'horaire
 * qu'elles avaient reçu ne les concerne plus.
 *
 * L'horaire tenu se lit dans la transaction de la correction, **avant** que les
 * marques de la manche ne soient effacées (`forgetMatchReminders`), par une
 * lecture verrouillante — l'état le plus récent, que l'effacement verrouille de
 * toute façon. L'avis part après le commit, comme les lignes du journal
 * (`flushBotLogs`), et se jette avec elles si la transaction échoue
 * (`discardBotLogs`) : même contrat de cycle de vie que la file du journal,
 * même plafond par transaction.
 *
 * Rien ne part si les joueurs n'avaient reçu aucun horaire (pas de marque
 * `TOLD`, ou plus d'horaire après un retrait remis), ni pour un horaire passé
 * depuis plus de 12 h.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { MATCH_TOLD_KEY } from "@/lib/shared/discord-notifications";
import { announceEntrantsWithdrawn, type DepartedEntrant } from "./match-reminders";
import { HELD_TIME_GRACE_MS } from "./reminder-marks";

/** Avis retenus au plus par transaction (comme `MAX_PENDING_PER_TRANSACTION` du journal). */
const MAX_PENDING_NOTICES = 32;

/** Avis en attente, par connexion. */
const pending = new WeakMap<PoolConnection, DepartedEntrant[]>();

type HeldRow = RowDataPacket & { match_id: number; start_at: Date | string | null };

/** Une engagée qui quitte une manche, et la place qu'elle y occupait. */
export type Departure = { matchId: number; teamId: number; slot: 1 | 2 };

/**
 * Note que des engagées quittent leurs manches : celles dont les joueurs
 * tiennent un horaire encore valable recevront un avis après le commit. Une
 * seule lecture pour toutes. À appeler **avant** l'effacement des marques.
 */
export async function noteDepartedEntrants(connection: PoolConnection, departures: readonly Departure[]): Promise<void> {
  if (departures.length === 0) return;
  const matchIds = [...new Set(departures.map((departure) => departure.matchId))];
  let rows: HeldRow[];
  try {
    [rows] = await connection.execute<HeldRow[]>(
      `SELECT match_id, start_at FROM bg_match_reminders
        WHERE match_id IN (${matchIds.map(() => "?").join(", ")}) AND offset_key = ?
        FOR UPDATE`,
      [...matchIds, MATCH_TOLD_KEY],
    );
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }
  const held = new Map(rows.map((row) => [Number(row.match_id), row.start_at]));
  const queue = pending.get(connection) ?? [];
  let dropped = 0;
  for (const departure of departures) {
    const startAt = held.get(departure.matchId) ?? null;
    if (startAt === null || new Date(startAt).getTime() <= Date.now() - HELD_TIME_GRACE_MS) continue;
    if (queue.length >= MAX_PENDING_NOTICES) dropped += 1;
    else queue.push({ ...departure, heldStartAt: startAt });
  }
  if (queue.length > 0) pending.set(connection, queue);
  // Au-delà du plafond, ces joueurs ne seront pas prévenus : pm2 le dit.
  if (dropped > 0) console.warn(`[notify] ${dropped} avis de match retiré au-delà du plafond, non envoyés`);
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
  if (notices.length === 0) return;
  void announceEntrantsWithdrawn(notices).catch((error: unknown) => {
    if (!isMissingTableError(error)) console.error("[notify] avis de match retiré non envoyé", error);
  });
}
