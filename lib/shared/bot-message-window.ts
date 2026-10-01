/**
 * La fenêtre des compteurs de messages du bot, et la lecture tolérante des
 * charges qui les portent pendant un déploiement.
 *
 * Le bot efface ses messages relayés (`OGMsg` / `DPMsg`) au bout de
 * `MESSAGE_RETENTION_DAYS` (7 jours). Ses compteurs étaient pourtant annoncés
 * sur 30 jours (`messagesLast30Days`, `relays30j`, tuiles « / 30j ») et la
 * tendance des tuiles « messages » et « relais » se comparait à la période
 * 30–60 jours — toujours vide. Les deux côtés comptent désormais sur 7 jours.
 *
 * Le bot et le site se déploient séparément : le site lit donc les **deux**
 * noms de champ, le nouveau d'abord. L'ancien n'est pas un mensonge à relayer —
 * un bot d'avant comptait sur 30 jours une table qui n'en gardait que sept.
 */

import type { BotServerEntry, BotServersPayload, BotStats } from "@/lib/shared/types";

/** Fenêtre de conservation des messages relayés par le bot, en jours. */
export const BOT_MESSAGE_WINDOW_DAYS = 7;

/** Le libellé d'unité des tuiles et colonnes qui comptent sur cette fenêtre. */
export const BOT_MESSAGE_WINDOW_LABEL = `${BOT_MESSAGE_WINDOW_DAYS}j`;

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value !== null && typeof value === "object" ? (value as RawRecord) : {};
}

/** Le premier compte numérique fini trouvé parmi les noms donnés, sinon 0. */
function firstCount(record: RawRecord, keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * `/internal/stats`, ancien (`…Last30Days`) ou nouveau (`…Last7Days`) bot.
 * Un compte absent ou illisible vaut 0, comme le repli d'un bot injoignable.
 */
export function normalizeBotStats(raw: unknown): BotStats {
  const record = asRecord(raw);
  return {
    affiliatedServers: firstCount(record, ["affiliatedServers"]),
    affiliatedChannels: firstCount(record, ["affiliatedChannels"]),
    messagesLast7Days: firstCount(record, ["messagesLast7Days", "messagesLast30Days"]),
    relayedMessagesLast7Days: firstCount(record, ["relayedMessagesLast7Days", "relayedMessagesLast30Days"]),
    uniqueUsersLast7Days: firstCount(record, ["uniqueUsersLast7Days", "uniqueUsersLast30Days"]),
  };
}

/**
 * Une ligne de `/internal/servers` : `relays7j`, ou `relays30j` d'un bot
 * d'avant. Le reste de la ligne n'est pas validé ici — le tableau le lit par
 * `botPayloadNumber` et ses voisins, qui rendent un tiret plutôt qu'un zéro.
 *
 * Une ligne qui n'est pas un objet (`null`, chaîne, tableau) est rendue
 * **telle quelle** : le tableau l'écarte comme illisible, et l'habiller en
 * objet la ferait passer pour un serveur vide.
 */
export function normalizeBotServerEntry(raw: unknown): BotServerEntry {
  if (!isPlainRecord(raw)) return raw as BotServerEntry;
  const { relays30j, ...rest } = raw;
  return { ...rest, relays7j: raw.relays7j ?? relays30j } as BotServerEntry;
}

/**
 * `/internal/servers` entier. Une charge qui n'est pas un objet, ou une liste
 * `servers` absente ou mal typée, reste telle quelle — le tableau en dit
 * déjà ce qu'il faut.
 */
export function normalizeBotServersPayload(raw: unknown): BotServersPayload {
  if (!isPlainRecord(raw) || !Array.isArray(raw.servers)) return raw as BotServersPayload;
  return { ...raw, servers: raw.servers.map(normalizeBotServerEntry) } as BotServersPayload;
}

function isPlainRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
