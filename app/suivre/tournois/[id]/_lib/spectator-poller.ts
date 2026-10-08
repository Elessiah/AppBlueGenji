import type { TournamentDetail, TournamentSnapshot } from "@/lib/shared/types";
import { shareUnchanged, type LiveFailure } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import {
  jitteredDelayMs,
  parsePollAfterMs,
  SPECTATOR_FRESHNESS_HEADER,
  SPECTATOR_NOT_FOUND_RETRY_MS,
  SPECTATOR_POLL_HEADER,
  SPECTATOR_RUNNING_POLL_MS,
  SPECTATOR_VIEWER_CONTEXT,
  spectatorRetryDelayMs,
} from "@/lib/shared/spectator-view";

/** Ce que la page sans compte affiche de son suivi. */
export type SpectatorState = {
  detail: TournamentDetail | null;
  /** La dernière lecture a-t-elle abouti ? */
  isLive: boolean;
  fatal: LiveFailure | null;
  /** Cadence accordée par le serveur ; `null` = tournoi introuvable (relu au plafond). */
  cadenceMs: number | null;
  /** Âge maximal de l'affichage, que le témoin annonce (`x-bg-fresh-within-ms`). */
  freshnessMs: number | null;
  /** Une lecture a échoué avant la première réussite. */
  retrying: boolean;
};

export const INITIAL_SPECTATOR_STATE: SpectatorState = {
  detail: null,
  isLive: false,
  fatal: null,
  cadenceMs: SPECTATOR_RUNNING_POLL_MS,
  freshnessMs: null,
  retrying: false,
};

/** Le monde extérieur, injecté : le navigateur en production, des doubles en test. */
export type SpectatorPollerEnv = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Onglet caché : on ne relit rien. */
  isHidden: () => boolean;
  random?: () => number;
};

export type SpectatorPoller = {
  /** Première lecture, tout de suite — ou au retour sur l'onglet s'il est caché. */
  start: () => Promise<void>;
  /** L'onglet a changé de visibilité. */
  attentionChanged: () => void;
  dispose: () => void;
};

/**
 * Suivi d'un tournoi **sans compte** (`docs/features/SPECTATOR_VIEW.md`),
 * hors React pour se tester sans navigateur.
 *
 * Pas de flux SSE : une lecture publique, relue à la cadence que le **serveur**
 * choisit selon sa charge (`x-bg-poll-after-ms`), avec `If-None-Match` — une
 * relecture qui ne trouve rien de neuf coûte un `304` sans corps. Rien n'est
 * relu tant que l'onglet est caché ; au retour, la lecture due part aussitôt.
 * Échec après échec, l'attente double jusqu'au plafond. Un introuvable est
 * relu au plafond (`SPECTATOR_NOT_FOUND_RETRY_MS`).
 */
export function createSpectatorPoller(
  tournamentId: number,
  env: SpectatorPollerEnv,
  onState: (state: SpectatorState) => void,
): SpectatorPoller {
  let state = INITIAL_SPECTATOR_STATE;
  let etag: string | null = null;
  /** Prochaine lecture prévue (horodatage), `null` = aucune. */
  let dueAt: number | null = null;
  /** Dernière attente armée : la base du recul après un échec. */
  let lastWaitMs = SPECTATOR_RUNNING_POLL_MS;
  let timer: unknown = null;
  let inflight = false;
  let disposed = false;
  /** Coupe la lecture en vol au démontage : rien à télécharger pour personne. */
  const abort = new AbortController();

  const commit = (next: SpectatorState) => {
    state = next;
    if (!disposed) onState(next);
  };

  const clearTimer = () => {
    if (timer !== null) {
      env.clearTimeout(timer);
      timer = null;
    }
  };

  const arm = (wait: number) => {
    timer = env.setTimeout(() => {
      timer = null;
      void load();
    }, wait);
  };

  /** Arme la prochaine lecture — sauf onglet caché : le retour la relancera. */
  const schedule = (delayMs: number | null) => {
    clearTimer();
    if (delayMs === null || disposed) {
      dueAt = null;
      return;
    }
    lastWaitMs = delayMs;
    const wait = jitteredDelayMs(delayMs, env.random);
    dueAt = env.now() + wait;
    if (!env.isHidden()) arm(wait);
  };

  async function load(): Promise<void> {
    if (inflight || disposed) return;
    inflight = true;
    const current = state;
    try {
      const headers: Record<string, string> = {};
      if (etag) headers["if-none-match"] = etag;
      const response = await env.fetch(`/api/spectator/tournaments/${tournamentId}`, {
        cache: "no-store",
        headers,
        signal: abort.signal,
      });
      if (disposed) return;

      if (response.status === 404 || response.status === 400) {
        commit({ ...current, isLive: false, fatal: "TOURNAMENT_NOT_FOUND", cadenceMs: null, freshnessMs: null });
        schedule(SPECTATOR_NOT_FOUND_RETRY_MS);
        return;
      }
      if (response.status !== 200 && response.status !== 304) {
        commit({ ...current, isLive: false, retrying: current.detail === null });
        schedule(spectatorRetryDelayMs(lastWaitMs, response.headers.get("retry-after")));
        return;
      }

      const cadenceMs = parsePollAfterMs(response.headers.get(SPECTATOR_POLL_HEADER));
      const freshnessHeader = Number(response.headers.get(SPECTATOR_FRESHNESS_HEADER));
      const freshnessMs = Number.isFinite(freshnessHeader) && freshnessHeader > 0 ? freshnessHeader : null;
      let detail = current.detail;
      if (response.status === 200) {
        const snapshot = (await response.json()) as TournamentSnapshot;
        etag = response.headers.get("etag");
        // Même partage structurel que le flux : les cartes inchangées ne se
        // redessinent pas.
        const shared = detail ? shareUnchanged(detail, snapshot) : snapshot;
        detail = { ...shared, ...SPECTATOR_VIEWER_CONTEXT };
      }
      commit({ detail, isLive: true, fatal: null, cadenceMs, freshnessMs, retrying: false });
      schedule(cadenceMs);
    } catch {
      if (disposed) return;
      // Réseau coupé : on garde ce qui est affiché, et on recule.
      commit({ ...current, isLive: false, retrying: current.detail === null });
      schedule(spectatorRetryDelayMs(lastWaitMs, null));
    } finally {
      inflight = false;
    }
  }

  return {
    start() {
      // Ouvert dans un onglet d'arrière-plan (lien Discord) : la première
      // lecture attend le retour sur l'onglet, comme les suivantes.
      if (env.isHidden()) {
        dueAt = env.now();
        return Promise.resolve();
      }
      return load();
    },
    attentionChanged() {
      if (disposed) return;
      if (env.isHidden()) {
        clearTimer();
        return;
      }
      if (dueAt === null || timer !== null || inflight) return;
      const remaining = dueAt - env.now();
      if (remaining <= 0) void load();
      else arm(remaining);
    },
    dispose() {
      disposed = true;
      abort.abort();
      clearTimer();
      dueAt = null;
    },
  };
}
