/**
 * Lots du journal Discord : une série de gestes ne fait plus une série de
 * messages (`docs/features/LOG_BATCHING.md`).
 *
 * Une ligne demandée ne part pas : elle rejoint le lot de sa clé (salon, tournoi,
 * puis catégorie du geste : un lot ne mêle jamais deux types de ligne) et relance un silence de {@link BOT_LOG_BATCH_WINDOW_MS}. Chaque
 * nouvelle ligne relance ce silence ; le lot part quand il échoit, ou **tout de
 * suite** dès qu'il compte {@link BOT_LOG_BATCH_MAX_LINES} lignes, ou encore
 * {@link BOT_LOG_BATCH_MAX_AGE_MS} après sa première ligne, même si les lignes
 * se succèdent sans silence. Le lot part
 * en un seul message, découpé seulement si la limite de Discord l'impose
 * (`packBotLogLines`).
 *
 * L'état est en mémoire : un arrêt brutal perd au plus les lots en attente (au
 * plus quatre lignes par clé, soit dix minutes de journal). Un arrêt propre les
 * envoie (`instrumentation.ts` → {@link BotLogBatcher.flushAll}). Les minuteurs
 * sont `unref()` : ils ne retiennent jamais le processus.
 *
 * L'envoi passe par le `send` injecté (le transport `/internal/log`), qui reste
 * au meilleur effort : un bot injoignable perd le lot comme il perdait la ligne.
 */
import {
  DEFAULT_BOT_LOG_CATEGORY,
  type BotLogCategory,
} from "@/lib/shared/bot-log-category";
import {
  BOT_LOG_BATCH_MAX_AGE_MS,
  BOT_LOG_BATCH_MAX_LINES,
  BOT_LOG_BATCH_WINDOW_MS,
  BOT_LOG_MESSAGE_MAX_CHARS,
  packBotLogLines,
} from "@/lib/shared/bot-log-batch";

export interface BotLogBatcherOptions {
  /** Envoie un message déjà assemblé, de la catégorie de son lot ; ses erreurs sont avalées. */
  send: (message: string, category: BotLogCategory) => Promise<void>;
  /** En-tête posé en tête de chaque message d'une catégorie ; aucun par défaut. */
  header?: (category: BotLogCategory) => string;
  windowMs?: number;
  maxAgeMs?: number;
  maxLines?: number;
  maxChars?: number;
}

export interface BotLogBatcher {
  /** Ajoute une ligne au lot de `key` ; ne lève jamais, n'attend rien. */
  add(key: string, line: string, category?: BotLogCategory): void;
  /** Envoie tout de suite le lot de `key`, s'il existe ; se résout une fois parti. */
  flush(key: string): Promise<void>;
  /** Envoie tous les lots en attente (arrêt du serveur) ; se résout une fois partis. */
  flushAll(): Promise<void>;
  /** Lignes en attente par clé. Lecture seule, pour les tests et le diagnostic. */
  pending(): Map<string, number>;
  /** Abandonne les lots sans les envoyer. Réservé aux tests. */
  reset(): void;
}

type Timer = ReturnType<typeof setTimeout>;
type Batch = { category: BotLogCategory; lines: string[]; timer: Timer | null; ageTimer: Timer | null };

export function createBotLogBatcher(options: BotLogBatcherOptions): BotLogBatcher {
  const windowMs = options.windowMs ?? BOT_LOG_BATCH_WINDOW_MS;
  const maxAgeMs = options.maxAgeMs ?? BOT_LOG_BATCH_MAX_AGE_MS;
  const maxLines = Math.max(1, options.maxLines ?? BOT_LOG_BATCH_MAX_LINES);
  const maxChars = options.maxChars ?? BOT_LOG_MESSAGE_MAX_CHARS;
  const batches = new Map<string, Batch>();
  // Les envois s'enchaînent : deux lots d'une même clé partis coup sur coup
  // arrivent dans l'ordre où ils ont été formés.
  let chain: Promise<void> = Promise.resolve();

  function clearTimers(batch: Batch): void {
    if (batch.timer) clearTimeout(batch.timer);
    if (batch.ageTimer) clearTimeout(batch.ageTimer);
    batch.timer = null;
    batch.ageTimer = null;
  }

  /** Minuteur qui n'envoie que si son lot est encore celui de la clé. */
  function arm(key: string, batch: Batch, ms: number): Timer {
    // Le lot a pu partir (plafond, arrêt) puis renaître : seuls ses propres
    // minuteurs l'envoient.
    const timer = setTimeout(() => {
      if (batches.get(key) === batch) void flush(key);
    }, ms);
    timer.unref?.();
    return timer;
  }

  function take(key: string): Batch | null {
    const batch = batches.get(key);
    if (!batch) return null;
    clearTimers(batch);
    batches.delete(key);
    return batch;
  }

  function dispatch(batch: Batch | null): Promise<void> {
    if (!batch) return chain;
    const { category } = batch;
    // Chaque message s'ouvre sur l'en-tête de sa catégorie : la place lui est
    // retirée avant le découpage.
    const header = options.header?.(category) ?? "";
    const packed = packBotLogLines(batch.lines, header ? Math.max(2, maxChars - header.length - 1) : maxChars);
    const messages = header ? packed.map((message) => `${header}\n${message}`) : packed;
    if (packed.length === 0) return chain;
    chain = chain.then(async () => {
      for (const message of messages) {
        try {
          await options.send(message, category);
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
    add(key, line, category = DEFAULT_BOT_LOG_CATEGORY) {
      if (!line.trim()) return;
      let batch = batches.get(key);
      if (!batch) {
        batch = { category, lines: [], timer: null, ageTimer: null };
        batches.set(key, batch);
      }
      batch.lines.push(line);
      if (batch.timer) clearTimeout(batch.timer);
      batch.timer = null;
      if (batch.lines.length >= maxLines) {
        void flush(key);
        return;
      }
      batch.timer = arm(key, batch, windowMs);
      // L'âge court dès la première ligne et ne se relance jamais.
      batch.ageTimer ??= arm(key, batch, maxAgeMs);
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
      for (const batch of batches.values()) clearTimers(batch);
      batches.clear();
      chain = Promise.resolve();
    },
  };
}
