import type { RowDataPacket } from "mysql2/promise";
import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/server/api-guard";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import {
  CONNECTION_LOG_RETENTION_DAYS,
  connectionLogIp,
  type ConnectionLogEvent,
} from "@/lib/shared/connection-logs";

/**
 * Écriture du journal des données de connexion (`bg_connection_logs`), et sa
 * purge. Règle et durée : `lib/shared/connection-logs.ts`.
 *
 * **Aucune fonction de lecture n'est offerte hors de l'export du titulaire**
 * ({@link listOwnConnectionLogs}) : le journal ne se consulte que sur
 * réquisition d'une autorité, par le responsable technique, en base.
 */

/** Au plus une purge par heure et par processus : elle suit les connexions. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

/** Pour les tests : oublie la dernière purge. */
export function resetConnectionLogPurgeForTests(): void {
  lastPurgeAt = 0;
}

/**
 * Consigne une ouverture de session. **Ne lève jamais** : une panne du journal
 * ne doit pas refuser une connexion — elle est écrite dans les journaux du
 * serveur, et la connexion est servie.
 *
 * L'adresse est celle que retient la chaîne des proxys de confiance
 * (`TRUSTED_PROXY_HOPS`), jamais un en-tête client pris tel quel ; illisible ou
 * absente, la ligne est écrite sans adresse (date et compte restent dus).
 */
export async function recordConnection(userId: number, event: ConnectionLogEvent): Promise<void> {
  try {
    let ip: string | null = null;
    try {
      ip = connectionLogIp(clientIpFromHeaders(await headers()));
    } catch {
      // Hors d'une requête (script, test) : pas d'adresse à relever.
      ip = null;
    }

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO bg_connection_logs (user_id, event_type, ip) VALUES (?, ?, ?)`,
      [userId, event, ip],
    );
  } catch (error) {
    console.error(`[connection-logs] écriture impossible (compte #${userId}) :`, (error as Error).message);
  }
  // À part de l'écriture : une insertion qui échoue ne doit pas arrêter la
  // purge. Elle suit aussi le trafic de la liste des tournois
  // (`listTournamentBuckets`), pour les périodes sans connexion.
  try {
    await purgeExpiredConnectionLogs();
  } catch (error) {
    console.error("[connection-logs] purge impossible :", (error as Error).message);
  }
}

/**
 * Efface les lignes arrivées à échéance. Étranglée à une passe par heure et
 * par processus ; lève en cas d'échec (l'appelant l'avale).
 */
export async function purgeExpiredConnectionLogs(now: number = Date.now()): Promise<number> {
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return 0;
  const db = await getDatabase();
  const [result] = await db.execute(
    `DELETE FROM bg_connection_logs WHERE created_at < NOW() - INTERVAL ? DAY`,
    [CONNECTION_LOG_RETENTION_DAYS],
  );
  // Noté **après** le succès seulement : une purge échouée se retente à la
  // connexion suivante, sans quoi une panne passagère laisserait des lignes
  // au-delà de la durée annoncée pendant une heure de plus à chaque fois.
  lastPurgeAt = now;
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * Les lignes du titulaire, pour l'export de ses données (droit d'accès,
 * RGPD art. 15) — seul lecteur du journal dans l'application.
 */
export async function listOwnConnectionLogs(
  userId: number,
): Promise<{ event: string; ip: string | null; createdAt: string }[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { event_type: string; ip: string | null; created_at: Date | string })[]
  >(
    `SELECT event_type, ip, created_at FROM bg_connection_logs WHERE user_id = ? ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((row) => ({
    event: row.event_type,
    ip: row.ip,
    createdAt: toIso(row.created_at) ?? String(row.created_at),
  }));
}
