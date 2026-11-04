/**
 * Arrêt propre du serveur : les lots du journal Discord en attente partent
 * avant la fin du processus (`docs/features/LOG_BATCHING.md`).
 *
 * pm2 envoie `SIGINT` puis tue le processus après `kill_timeout` (1,6 s par
 * défaut) ; Next ferme le serveur sur le même signal, puis appelle
 * `process.exit(0)` sans nous attendre. Pendant l'envoi, `process.exit` est
 * donc **retenu** ({@link holdExitUntil}) : l'appel de Next ne prend effet
 * qu'une fois les lots partis. L'envoi est borné à
 * {@link SHUTDOWN_FLUSH_TIMEOUT_MS}, sous le délai de pm2 ; les lots des
 * différents tournois partent **en parallèle** (`flushAll`), si bien qu'un bot
 * lent coûte un envoi, pas un envoi par lot. Quand
 * personne d'autre n'écoute le signal (Next lancé avec
 * `NEXT_MANUAL_SIG_HANDLE`), ce module relance lui-même le signal une fois
 * l'envoi fini : écouter un signal retire le comportement par défaut de Node, et
 * le relancer sans écouteur rend la sortie attendue (code 128 + n).
 *
 * Un seul vidage par processus : `SIGINT` puis `SIGTERM` partagent le même. Le
 * drapeau d'installation et ce vidage vivent sur `globalThis`, comme les lots :
 * un module chargé deux fois (deux bundles, dev) ne pose pas deux paires
 * d'écouteurs.
 */
import { flushAllBotLogBatches } from "@/lib/server/bot-integration";
import { flushAllCoalescers } from "@/lib/server/coalescer";

export const SHUTDOWN_FLUSH_TIMEOUT_MS = 1200;

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** État de l'arrêt propre, partagé par toutes les copies du module. */
type ShutdownState = { installed: boolean; flush: Promise<void> | null };
const shutdownGlobal = globalThis as typeof globalThis & {
  __bgBotLogShutdown?: ShutdownState;
  /** Tour du dernier passage de `flushBotLogs` (`tournaments/bot-logs.ts`). */
  __bgBotLogOrder?: Promise<void>;
};

function shutdownState(): ShutdownState {
  if (!shutdownGlobal.__bgBotLogShutdown) shutdownGlobal.__bgBotLogShutdown = { installed: false, flush: null };
  return shutdownGlobal.__bgBotLogShutdown;
}

/** Envoie les lots en attente, sans dépasser `timeoutMs`. Ne lève jamais. */
export async function flushBotLogsBeforeExit(timeoutMs: number = SHUTDOWN_FLUSH_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  try {
    // Les rafales regroupées (journal du staff, casts) rejoignent d'abord les
    // lots, mais ne tiennent que la moitié du délai : des lectures lentes ne
    // doivent pas priver les lots déjà en attente de leur envoi.
    const coalesced = Promise.all([
      flushAllCoalescers().catch(() => undefined),
      // Les passages encore en train de résoudre leurs lignes les posent au lot
      // avant le vidage ; la limite de la moitié du délai les borne aussi.
      shutdownGlobal.__bgBotLogOrder?.catch(() => undefined),
    ]).then(() => undefined);
    let half: ReturnType<typeof setTimeout> | null = null;
    const halfDeadline = new Promise<void>((resolve) => {
      half = setTimeout(resolve, timeoutMs / 2);
      half.unref?.();
    });
    await Promise.race([coalesced, halfDeadline]);
    if (half) clearTimeout(half);
    await Promise.race([flushAllBotLogBatches().catch(() => undefined), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Un code de sortie qui signale un échec (tout sauf l'absence de code et `0`). */
function isFailureCode(code: number | string | null | undefined): boolean {
  return code !== undefined && code !== null && Number(code) !== 0;
}

/**
 * Retient `process.exit` jusqu'à `done` : un appel de **succès** pendant l'envoi
 * est rejoué une fois l'envoi fini (un appel suivant ne relance rien). Un code
 * d'**échec** sort aussitôt, retenu ou non : un gestionnaire fatal qui appelle
 * `process.exit(1)` — avant ou après le `process.exit(0)` de Next — ne voit pas
 * son code poursuivre pendant l'envoi, et pm2 lit bien un échec. `process.exit`
 * n'est rendu que si personne ne l'a appelé pendant l'envoi.
 */
export function holdExitUntil(done: Promise<void>): void {
  const originalExit = process.exit;
  let requested = false;
  let exited = false;
  const exitNow = (code: number | string | null | undefined) => {
    if (exited) return;
    exited = true;
    // `process.exit` reste retenu : un appel qui suivrait la sortie ne la rejoue pas.
    originalExit.call(process, code);
  };
  const held = ((code?: number | string | null) => {
    // `process.exit()` sans argument sort avec `process.exitCode`.
    const requestedCode = code ?? process.exitCode;
    if (isFailureCode(requestedCode)) {
      exitNow(requestedCode);
      return undefined as never;
    }
    if (requested) return undefined as never;
    requested = true;
    void done.finally(() => exitNow(code));
    return undefined as never;
  }) as typeof process.exit;
  process.exit = held;
  void done.finally(() => {
    if (!requested && process.exit === held) process.exit = originalExit;
  });
}

/** Branche l'envoi des lots sur les signaux d'arrêt ; une seule fois par processus. */
export function installBotLogShutdownFlush(): void {
  const state = shutdownState();
  if (state.installed) return;
  state.installed = true;
  for (const signal of SIGNALS) {
    process.once(signal, () => {
      // Un second signal rejoint le vidage en cours : ni second envoi, ni
      // second `process.exit` retenu par-dessus le premier.
      let flush = state.flush;
      if (!flush) {
        const started = flushBotLogsBeforeExit();
        flush = started;
        state.flush = started;
        holdExitUntil(started);
        // Un processus qui survit à l'arrêt rebatche ses lignes : un signal
        // ultérieur doit vider de nouveau, non réutiliser ce vidage terminé.
        void started.then(() => {
          if (state.flush === started) state.flush = null;
        });
      }
      void flush.then(() => {
        // Personne d'autre n'écoute : le signal relancé sans écouteur termine le
        // processus comme Node l'aurait fait (128 + n), et non en succès.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }
}
