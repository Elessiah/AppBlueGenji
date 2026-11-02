/**
 * Arrêt propre du serveur : les lots du journal Discord en attente partent
 * avant la fin du processus (`docs/features/LOG_BATCHING.md`).
 *
 * pm2 envoie `SIGINT` puis tue le processus après `kill_timeout` (1,6 s par
 * défaut) ; Next ferme le serveur sur le même signal. L'envoi est donc borné à
 * {@link SHUTDOWN_FLUSH_TIMEOUT_MS} et ne retient jamais l'arrêt. Quand
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

/** Branche l'envoi des lots sur les signaux d'arrêt ; une seule fois par processus. */
export function installBotLogShutdownFlush(): void {
  if (installed) return;
  installed = true;
  for (const signal of SIGNALS) {
    process.once(signal, () => {
      void flushBotLogsBeforeExit().then(() => {
        if (process.listenerCount(signal) === 0) process.exit(0);
      });
    });
  }
}

/** Remet le module à zéro. Réservé aux tests. */
export function resetBotLogShutdownState(): void {
  installed = false;
}
