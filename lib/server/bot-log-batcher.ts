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
 * Un seul minuteur par lot, posé à l'échéance la plus proche (silence ou âge) et
 * réarmé à son réveil quand une ligne a repoussé le silence entre-temps.
 *
 * Les envois s'enchaînent **par portée** (`scopeOf` : un tournoi, ou le salon
 * hors tournoi) : les lots d'un même tournoi partent dans l'ordre où ils ont été
 * formés, mais un envoi lent d'un tournoi ne retarde jamais ceux d'un autre.
 *
 * L'état est en mémoire : un arrêt brutal perd au plus les lots en attente (au
 * plus quatre lignes par clé, soit dix minutes de journal). Un arrêt propre les
 * envoie (`instrumentation.ts` → {@link BotLogBatcher.flushAll}) ; une ligne
 * demandée ensuite part aussitôt. Les minuteurs sont `unref()` : ils ne
 * retiennent jamais le processus.
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
  /** Portée d'une clé, dont les envois s'enchaînent ; la clé elle-même par défaut. */
  scopeOf?: (key: string) => string;
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
  /**
   * Envoie tout de suite les lots de `keys` qui existent, dans l'ordre de leur
   * **première ligne** ; se résout une fois partis.
   */
  flushKeys(keys: readonly string[]): Promise<void>;
  /**
   * Envoie tous les lots en attente (arrêt du serveur), les portées en
   * parallèle ; se résout une fois partis. Toute ligne ajoutée ensuite part
   * aussitôt.
   */
  flushAll(): Promise<void>;
  /** Lignes en attente par clé. Lecture seule, pour les tests et le diagnostic. */
  pending(): Map<string, number>;
  /** Abandonne les lots sans les envoyer. Réservé aux tests. */
  reset(): void;
}

type Timer = ReturnType<typeof setTimeout>;
type Batch = {
  category: BotLogCategory;
  lines: string[];
  timer: Timer | null;
  /** Rang de la première ligne, pour envoyer plusieurs lots dans l'ordre d'arrivée. */
  order: number;
  firstAt: number;
  lastAt: number;
};

/** Plus long délai qu'accepte `setTimeout` (au-delà, Node le ramène à 1 ms). */
export const MAX_TIMER_MS = 2_147_483_647;

/** Un délai utilisable : entier fini dans [1, 2^31 - 1], sinon `fallback`. */
function boundedMs(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_TIMER_MS, Math.max(1, Math.floor(value)));
}

/** Un entier fini au moins égal à `min`, sinon `fallback`. */
function boundedCount(value: number | undefined, min: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

/** Après `flushAll`, durée pendant laquelle une ligne part aussitôt (arrêt en cours). */
export const CLOSING_GRACE_MS = 10_000;

/** Tours au plus de `flushAll` : le temps que les lignes tardives soient parties. */
const MAX_FLUSH_ALL_ROUNDS = 5;

/** Place minimale laissée aux lignes sous un en-tête ; en deçà, l'en-tête est omis. */
export const MIN_ROOM_UNDER_HEADER = 16;

export function createBotLogBatcher(options: BotLogBatcherOptions): BotLogBatcher {
  const windowMs = boundedMs(options.windowMs, BOT_LOG_BATCH_WINDOW_MS);
  const maxAgeMs = boundedMs(options.maxAgeMs, BOT_LOG_BATCH_MAX_AGE_MS);
  const maxLines = boundedCount(options.maxLines, 1, BOT_LOG_BATCH_MAX_LINES);
  const maxChars = boundedCount(options.maxChars, 2, BOT_LOG_MESSAGE_MAX_CHARS);
  const scopeOf = options.scopeOf ?? ((key: string) => key);
  const batches = new Map<string, Batch>();
  // Les envois d'une même portée s'enchaînent : deux lots partis coup sur coup
  // arrivent dans l'ordre où ils ont été formés. Une chaîne par portée, retirée
  // une fois vide : un envoi lent ne retient que sa portée.
  const chains = new Map<string, Promise<void>>();
  let sequence = 0;
  let closing = false;
  let reopenTimer: Timer | null = null;

  function deadlineOf(batch: Batch): number {
    return Math.min(batch.lastAt + windowMs, batch.firstAt + maxAgeMs);
  }

  /** Pose le minuteur du lot ; il n'agit que s'il est encore le minuteur du lot de la clé. */
  function arm(key: string, batch: Batch, ms: number): void {
    const timer = setTimeout(() => {
      // Le lot a pu partir (plafond, arrêt) puis renaître, ou son minuteur être
      // remplacé : seul le minuteur courant du lot courant agit.
      if (batches.get(key) !== batch || batch.timer !== timer) return;
      batch.timer = null;
      const remaining = deadlineOf(batch) - Date.now();
      if (remaining > 0) arm(key, batch, remaining);
      else void flush(key);
    }, Math.min(MAX_TIMER_MS, Math.max(1, ms)));
    timer.unref?.();
    batch.timer = timer;
  }

  function take(key: string): Batch | null {
    const batch = batches.get(key);
    if (!batch) return null;
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = null;
    batches.delete(key);
    return batch;
  }

  function messagesOf(batch: Batch): string[] {
    // Chaque message s'ouvre sur l'en-tête de sa catégorie : la place lui est
    // retirée avant le découpage. Un en-tête qui ne laisserait plus de place aux
    // lignes est omis plutôt que de faire dépasser la limite.
    const header = options.header?.(batch.category) ?? "";
    const room = maxChars - header.length - 1;
    const headed = header !== "" && room >= MIN_ROOM_UNDER_HEADER;
    const packed = packBotLogLines(batch.lines, headed ? room : maxChars);
    return headed ? packed.map((message) => `${header}\n${message}`) : packed;
  }

  /**
   * Messages d'un lot, sans jamais lever : un en-tête (`options.header`) qui
   * échoue ne fait pas perdre le lot, qui part alors sans en-tête.
   */
  function safeMessagesOf(batch: Batch): string[] {
    try {
      return messagesOf(batch);
    } catch {
      try {
        return packBotLogLines(batch.lines, maxChars);
      } catch {
        return [];
      }
    }
  }

  function dispatch(key: string, batch: Batch): Promise<void> {
    const messages = safeMessagesOf(batch);
    const scope = scopeOf(key);
    const previous = chains.get(scope) ?? Promise.resolve();
    if (messages.length === 0) return previous;
    const { category } = batch;
    const next = previous.then(async () => {
      for (const message of messages) {
        try {
          await options.send(message, category);
        } catch {
          // Meilleur effort : comme une ligne seule auparavant.
        }
      }
    });
    chains.set(scope, next);
    void next.then(() => {
      if (chains.get(scope) === next) chains.delete(scope);
    });
    return next;
  }

  /** Fin des envois déjà en cours des portées de `keys` (un lot parti n'est pas encore arrivé). */
  function inFlight(keys: readonly string[]): Promise<void> {
    const tails = new Set<Promise<void>>();
    for (const key of keys) {
      const tail = chains.get(scopeOf(key));
      if (tail) tails.add(tail);
    }
    return Promise.all(tails).then(() => undefined);
  }

  function flushKeys(keys: readonly string[]): Promise<void> {
    const taken: Array<[string, Batch]> = [];
    for (const key of new Set(keys)) {
      const batch = take(key);
      if (batch) taken.push([key, batch]);
    }
    // Rien en attente : les lots déjà partis de la portée sont peut-être encore
    // en route, et ce qui les suit (une alerte) ne doit pas les doubler.
    if (taken.length === 0) return inFlight(keys);
    taken.sort(([, a], [, b]) => a.order - b.order);
    return Promise.all(taken.map(([key, batch]) => dispatch(key, batch))).then(() => undefined);
  }

  function flush(key: string): Promise<void> {
    return flushKeys([key]);
  }

  return {
    add(key, line, category = DEFAULT_BOT_LOG_CATEGORY) {
      if (!line.trim()) return;
      let batch = batches.get(key);
      // Une clé ne porte qu'une catégorie : une ligne d'une autre catégorie
      // envoie d'abord le lot en cours, pour ne jamais en mêler deux. Un appelant
      // qui alterne les catégories sur une même clé défait donc le regroupement
      // (un message par changement) : les clés du journal portent leur catégorie
      // (`botLogBatchKey`), ce qui n'arrive pas.
      if (batch && batch.category !== category) {
        void flush(key);
        batch = undefined;
      }
      const now = Date.now();
      if (!batch) {
        sequence += 1;
        batch = { category, lines: [], timer: null, order: sequence, firstAt: now, lastAt: now };
        batches.set(key, batch);
      }
      batch.lines.push(line);
      batch.lastAt = now;
      if (closing || batch.lines.length >= maxLines) {
        void flush(key);
        return;
      }
      // L'échéance ne fait que reculer quand une ligne relance le silence : le
      // minuteur en place se réarme à son réveil, inutile de le recréer.
      if (!batch.timer) arm(key, batch, deadlineOf(batch) - now);
    },
    flush,
    flushKeys,
    async flushAll() {
      closing = true;
      // Une ligne ajoutée pendant l'envoi part aussitôt (`closing`) et ouvre une
      // chaîne : on boucle jusqu'au repos, dans la limite de quelques tours.
      for (let round = 0; round < MAX_FLUSH_ALL_ROUNDS; round += 1) {
        await flushKeys([...batches.keys()]);
        await Promise.all([...chains.values()]);
        if (batches.size === 0 && chains.size === 0) break;
      }
      // Un processus qui survit à l'arrêt (écouteur qui ne sort pas) retrouve
      // ses lots après un délai bien supérieur à celui de pm2.
      // Un seul minuteur de réouverture : un second `flushAll` (SIGINT puis
      // SIGTERM) repousse l'échéance au lieu d'en poser une autre.
      if (reopenTimer) clearTimeout(reopenTimer);
      reopenTimer = setTimeout(() => {
        closing = false;
        reopenTimer = null;
      }, CLOSING_GRACE_MS);
      reopenTimer.unref?.();
    },
    pending() {
      return new Map([...batches].map(([key, batch]) => [key, batch.lines.length]));
    },
    reset() {
      for (const batch of batches.values()) if (batch.timer) clearTimeout(batch.timer);
      batches.clear();
      chains.clear();
      if (reopenTimer) clearTimeout(reopenTimer);
      reopenTimer = null;
      closing = false;
      sequence = 0;
    },
  };
}
