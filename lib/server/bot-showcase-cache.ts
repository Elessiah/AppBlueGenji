/**
 * Lectures du bot mutualisées pour la vitrine `/bot`.
 *
 * La page porte un `export const revalidate` depuis sa création, mais il ne met
 * plus rien en cache : la mise en page racine lit `headers()` (nonce de la CSP),
 * si bien que **toutes** les pages sont rendues à la demande, et les appels
 * sortants sont en `cache: "no-store"`. Chaque vue de `/bot` interrogeait donc
 * le bot quatre fois — cinq, dont une jetée —, et une rafale de visiteurs se
 * traduisait en rafale d'appels sur le canal interne.
 *
 * Même remède que les agrégats de la vitrine : `cached()`, à vol unique. Les
 * durées sont celles que la page promettait sans les tenir (30 s pour l'état
 * du bot, que la page affiche en direct — latence, disponibilité —, 60 s pour
 * le reste, qui bouge à l'échelle de la journée).
 *
 * Un `null` (bot injoignable, réponse refusée) **est** retenu, comme le refus du
 * compteur de membres Discord (`./discord-community`) : réinterroger un bot en
 * panne à chaque vue ferait attendre chaque visiteur jusqu'au délai d'appel,
 * pour la même réponse. Le prix est au plus une durée de vie d'« injoignable »
 * après le retour du bot.
 */
import { cached } from "@/lib/server/cache";
import {
  fetchBotActivity,
  fetchBotKpis,
  fetchBotServers,
  fetchBotStatus,
} from "@/lib/server/bot-integration";
import type { BotActivity, BotKpis, BotServersPayload, BotStatus } from "@/lib/shared/types";

const PREFIX = "bot-showcase:";

/** État du bot (latence, disponibilité) : ce que la page montre « en direct ». */
export const BOT_STATUS_TTL_MS = 30_000;
/** Indicateurs, serveurs et activité : des grandeurs journalières. */
export const BOT_SHOWCASE_TTL_MS = 60_000;

export function cachedBotStatus(): Promise<BotStatus | null> {
  return cached(`${PREFIX}status`, BOT_STATUS_TTL_MS, fetchBotStatus);
}

export function cachedBotKpis(): Promise<BotKpis | null> {
  return cached(`${PREFIX}kpis`, BOT_SHOWCASE_TTL_MS, fetchBotKpis);
}

export function cachedBotServers(limit: number): Promise<BotServersPayload | null> {
  return cached(`${PREFIX}servers:${limit}`, BOT_SHOWCASE_TTL_MS, () => fetchBotServers(limit));
}

/**
 * Activité d'une plage. Partagée par le rendu de la page (plage de 30 jours) et
 * par `GET /api/bot/activity`, que le graphe appelle quand on change de plage :
 * une seule lecture par plage et par minute, d'où qu'elle vienne.
 */
export function cachedBotActivity(range: "7j" | "30j" | "90j"): Promise<BotActivity | null> {
  return cached(`${PREFIX}activity:${range}`, BOT_SHOWCASE_TTL_MS, () => fetchBotActivity(range));
}
