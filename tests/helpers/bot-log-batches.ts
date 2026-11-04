/**
 * Accès de test aux lots du journal Discord (`docs/features/LOG_BATCHING.md`).
 *
 * Le module de production n'exporte ni lecture ni remise à zéro des lots : un
 * appel hors test jetterait en silence les lignes en attente. Les tests les
 * atteignent par l'instance que `bot-integration.ts` pose sur `globalThis`.
 */
import "@/lib/server/bot-integration";
import type { BotLogBatcher } from "@/lib/server/bot-log-batcher";

function batcher(): BotLogBatcher {
  const state = globalThis as typeof globalThis & { __bgBotLogBatcher?: BotLogBatcher };
  if (!state.__bgBotLogBatcher) throw new Error("bot-integration n'a pas créé son lot");
  return state.__bgBotLogBatcher;
}

/** Lignes du journal en attente, par lot. */
export function pendingBotLogBatches(): Map<string, number> {
  return batcher().pending();
}

/** Abandonne les lots du journal en attente, sans les envoyer. */
export function resetBotLogBatches(): void {
  batcher().reset();
}

/** Remet à zéro l'arrêt propre (`bot-log-shutdown.ts`), dont l'état vit sur `globalThis`. */
export function resetBotLogShutdownState(): void {
  delete (globalThis as typeof globalThis & { __bgBotLogShutdown?: unknown }).__bgBotLogShutdown;
}
