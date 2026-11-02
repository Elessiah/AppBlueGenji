/**
 * Arrêt propre du serveur : les lots du journal Discord en attente partent
 * avant la fin du processus (`docs/features/LOG_BATCHING.md`).
 *
 * pm2 envoie `SIGINT` puis tue le processus après `kill_timeout` (1,6 s par
 * défaut) ; Next ferme le serveur sur le même signal, puis appelle
 * `process.exit(0)` sans nous attendre. Pendant l'envoi, `process.exit` est
 * donc **retenu** ({@link holdExitUntil}) : l'appel de Next ne prend effet
 * qu'une fois les lots partis. L'envoi est borné à
 * {@link SHUTDOWN_FLUSH_TIMEOUT_MS}, sous le délai de pm2. Quand
 * personne d'autre n'écoute le signal (Next lancé avec
 * `NEXT_MANUAL_SIG_HANDLE`), ce module termine lui-même le processus : écouter
 * un signal retire le comportement par défaut de Node.
 */
import { flushAllBotLogBatches } from "@/lib/server/bot-integration";

export const SHUTDOWN_FLUSH_TIMEOUT_MS = 1200;

const SIGNALS = ["SIGTERM", "SIGINT"] as const;
let installed = false;

/** Envoie les lots en attente, sans dépasser `timeoutMs`. Ne lève jamais. */
export async function flushBotLogsBeforeExit(timeoutMs: number = SHUTDOWN_FLUSH_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([flushAllBotLogBatches().catch(() => undefined), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Retient `process.exit` jusqu'à `done` : un appel pendant l'envoi est rejoué
 * avec son code une fois l'envoi fini. `process.exit` est rendu ensuite.
 */
export function holdExitUntil(done: Promise<void>): void {
  const originalExit = process.exit;
  let requested = false;
  const held = ((code?: number | string | null) => {
    if (requested) return undefined as never;
    requested = true;
    void done.finally(() => {
      if (process.exit === held) process.exit = originalExit;
      originalExit.call(process, code);
    });
    return undefined as never;
  }) as typeof process.exit;
  process.exit = held;
  void done.finally(() => {
    if (!requested && process.exit === held) process.exit = originalExit;
  });
}

/** Branche l'envoi des lots sur les signaux d'arrêt ; une seule fois par processus. */
export function installBotLogShutdownFlush(): void {
  if (installed) return;
  installed = true;
  for (const signal of SIGNALS) {
    process.once(signal, () => {
      const done = flushBotLogsBeforeExit();
      holdExitUntil(done);
      void done.then(() => {
        if (process.listenerCount(signal) === 0) process.exit(0);
      });
    });
  }
}

/** Remet le module à zéro. Réservé aux tests. */
export function resetBotLogShutdownState(): void {
  installed = false;
}
