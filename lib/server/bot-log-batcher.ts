/**
 * Lots du journal Discord : une série de gestes ne fait plus une série de
 * messages (`docs/features/LOG_BATCHING.md`).
 *
 * Une ligne demandée ne part pas : elle rejoint le lot de sa clé (salon, puis
 * tournoi) et relance un silence de {@link BOT_LOG_BATCH_WINDOW_MS}. Chaque
 * nouvelle ligne relance ce silence ; le lot part quand il échoit, ou **tout de
 * suite** dès qu'il compte {@link BOT_LOG_BATCH_MAX_LINES} lignes. Le lot part
 * en un seul message, découpé seulement si la limite de Discord l'impose
 * (`packBotLogLines`).
 *
 * L'état est en mémoire : un arrêt brutal perd au plus les lots en attente (au
 * plus cinq lignes par clé, soit cinq minutes de journal). Un arrêt propre les
 * envoie (`instrumentation.ts` → {@link BotLogBatcher.flushAll}). Les minuteurs
 * sont `unref()` : ils ne retiennent jamais le processus.
 *
 * L'envoi passe par le `send` injecté (le transport `/internal/log`), qui reste
 * au meilleur effort : un bot injoignable perd le lot comme il perdait la ligne.
 */
import {
  BOT_LOG_BATCH_MAX_LINES,
  BOT_LOG_BATCH_WINDOW_MS,
  BOT_LOG_MESSAGE_MAX_CHARS,
  packBotLogLines,
} from "@/lib/shared/bot-log-batch";

export interface BotLogBatcherOptions {
  /** Envoie un message déjà assemblé ; ses erreurs sont avalées. */
  send: (message: string) => Promise<void>;
  windowMs?: number;
  maxLines?: number;
  maxChars?: number;
}

export interface BotLogBatcher {
  /** Ajoute une ligne au lot de `key` ; ne lève jamais, n'attend rien. */
  add(key: string, line: string): void;
  /** Envoie tout de suite le lot de `key`, s'il existe ; se résout une fois parti. */
  flush(key: string): Promise<void>;
  /** Envoie tous les lots en attente (arrêt du serveur) ; se résout une fois partis. */
  flushAll(): Promise<void>;
  /** Lignes en attente par clé. Lecture seule, pour les tests et le diagnostic. */
  pending(): Map<string, number>;
  /** Abandonne les lots sans les envoyer. Réservé aux tests. */
  reset(): void;
}

type Batch = { lines: string[]; timer: ReturnType<typeof setTimeout> | null };

export function createBotLogBatcher(options: BotLogBatcherOptions): BotLogBatcher {
  const windowMs = options.windowMs ?? BOT_LOG_BATCH_WINDOW_MS;
  const maxLines = Math.max(1, options.maxLines ?? BOT_LOG_BATCH_MAX_LINES);
  const maxChars = options.maxChars ?? BOT_LOG_MESSAGE_MAX_CHARS;
  const batches = new Map<string, Batch>();
  // Les envois s'enchaînent : deux lots d'une même clé partis coup sur coup
  // arrivent dans l'ordre où ils ont été formés.
  let chain: Promise<void> = Promise.resolve();

  function take(key: string): string[] {
    const batch = batches.get(key);
    if (!batch) return [];
    if (batch.timer) clearTimeout(batch.timer);
    batches.delete(key);
    return batch.lines;
  }

  function dispatch(lines: readonly string[]): Promise<void> {
    const messages = packBotLogLines(lines, maxChars);
    if (messages.length === 0) return chain;
    chain = chain.then(async () => {
      for (const message of messages) {
        try {
          await options.send(message);
        } catch {
          // Meilleur effort : comme une ligne seule auparavant.
        }
      }
    });
    return chain;
  }

  function flush(key: string): Promise<void> {
    return dispatch(take(key));
  }

  return {
    add(key, line) {
      if (!line.trim()) return;
      let batch = batches.get(key);
      if (!batch) {
        batch = { lines: [], timer: null };
        batches.set(key, batch);
      }
      batch.lines.push(line);
      if (batch.timer) clearTimeout(batch.timer);
      batch.timer = null;
      if (batch.lines.length >= maxLines) {
        void flush(key);
        return;
      }
      const timer = setTimeout(() => {
        // Le lot a pu partir (plafond, arrêt) puis renaître : seul son propre
        // minuteur l'envoie.
        if (batches.get(key)?.timer === timer) void flush(key);
      }, windowMs);
      timer.unref?.();
      batch.timer = timer;
    },
    flush,
    async flushAll() {
      for (const key of [...batches.keys()]) void dispatch(take(key));
      await chain;
    },
    pending() {
      return new Map([...batches].map(([key, batch]) => [key, batch.lines.length]));
    },
    reset() {
      for (const batch of batches.values()) if (batch.timer) clearTimeout(batch.timer);
      batches.clear();
      chain = Promise.resolve();
    },
  };
}
