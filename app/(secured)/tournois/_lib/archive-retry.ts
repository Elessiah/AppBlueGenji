/**
 * Relecture de l'archive des terminés après un échec, tant qu'une recherche
 * l'attend (`docs/features/TOURNOIS_LIST_EMPTY_LOOK.md`).
 *
 * Bornée et ménagère du serveur :
 * - délais croissants (`ARCHIVE_RETRY_DELAYS_MS`), puis plus rien — la
 *   relecture de fond habituelle prend le relais ;
 * - une tentative à la fois : la suivante n'est programmée qu'une fois la
 *   précédente réglée (un serveur lent ne voit jamais deux lectures d'un même
 *   onglet se chevaucher) ;
 * - onglet caché, la tentative due attend son retour au premier plan ;
 * - une issue `stop` (session partie, besoin retombé, abandon) clôt la série.
 */

/** Délais entre tentatives : 15 s, 30 s, 60 s, 120 s, puis arrêt. */
export const ARCHIVE_RETRY_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000, 120_000];

/** Issue d'une tentative : `failed` seule en programme une autre. */
export type ArchiveAttemptOutcome = "ok" | "failed" | "stop";

/** Délai avant la tentative de rang `attempt` (0 = la première), `null` au-delà de la borne. */
export function archiveRetryDelay(attempt: number): number | null {
  return ARCHIVE_RETRY_DELAYS_MS[attempt] ?? null;
}

/** Ce que la série lit de la page : injecté pour les tests. */
export type ArchiveRetryEnv = Readonly<{
  isHidden: () => boolean;
  /** Abonne `callback` au retour au premier plan ; rend le désabonnement. */
  onVisible: (callback: () => void) => () => void;
}>;

const browserEnv: ArchiveRetryEnv = {
  isHidden: () => document.visibilityState === "hidden",
  onVisible: (callback) => {
    const listener = () => {
      if (document.visibilityState !== "hidden") callback();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/**
 * Lance la série de tentatives ; rend sa fonction d'arrêt (minuteur, écoute de
 * visibilité et lecture en vol abandonnés).
 */
export function startArchiveRetry(
  attempt: (signal: AbortSignal) => Promise<ArchiveAttemptOutcome>,
  env: ArchiveRetryEnv = browserEnv,
): () => void {
  const controller = new AbortController();
  let stopped = false;
  let rank = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const schedule = () => {
    const delay = archiveRetryDelay(rank);
    if (delay === null || stopped) return;
    timer = setTimeout(fire, delay);
  };

  function fire() {
    timer = undefined;
    if (stopped) return;
    if (env.isHidden()) {
      unsubscribe = env.onVisible(() => {
        unsubscribe?.();
        unsubscribe = undefined;
        fire();
      });
      return;
    }
    rank += 1;
    attempt(controller.signal).then(
      (outcome) => {
        if (outcome === "failed") schedule();
      },
      () => schedule(),
    );
  }

  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
    controller.abort();
  };
}
