import type { TournamentDetail, TournamentSnapshot } from "@/lib/shared/types";
import { shareUnchanged, type LiveFailure } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import {
  jitteredDelayMs,
  parsePollAfterMs,
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
  /** Cadence accordée par le serveur ; `null` = plus de relecture. */
  cadenceMs: number | null;
};

export const INITIAL_SPECTATOR_STATE: SpectatorState = {
  detail: null,
  isLive: false,
  fatal: null,
  cadenceMs: SPECTATOR_RUNNING_POLL_MS,
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
  /** Première lecture, tout de suite. */
  start: () => Promise<void>;
  /** Relecture immédiate. */
  load: () => Promise<void>;
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
 * Plus rien après la fin du tournoi (en-tête absent) ni après un 404.
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
  let timer: unknown = null;
  let inflight = false;
  let disposed = false;

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
      const response = await env.fetch(`/api/spectator/tournaments/${tournamentId}`, { cache: "no-store", headers });
      if (disposed) return;

      if (response.status === 404 || response.status === 400) {
        commit({ ...current, isLive: false, fatal: "TOURNAMENT_NOT_FOUND", cadenceMs: null });
        schedule(null);
        return;
      }
      if (response.status !== 200 && response.status !== 304) {
        commit({ ...current, isLive: false });
        schedule(spectatorRetryDelayMs(current.cadenceMs, response.headers.get("retry-after")));
        return;
      }

      const cadenceMs = parsePollAfterMs(response.headers.get(SPECTATOR_POLL_HEADER));
      let detail = current.detail;
      if (response.status === 200) {
        const snapshot = (await response.json()) as TournamentSnapshot;
        etag = response.headers.get("etag");
        // Même partage structurel que le flux : les cartes inchangées ne se
        // redessinent pas.
        const shared = detail ? shareUnchanged(detail, snapshot) : snapshot;
        detail = { ...shared, ...SPECTATOR_VIEWER_CONTEXT };
      }
      commit({ detail, isLive: true, fatal: null, cadenceMs });
      schedule(cadenceMs);
    } catch {
      if (disposed) return;
      // Réseau coupé : on garde ce qui est affiché, et on recule.
      commit({ ...current, isLive: false });
      schedule(spectatorRetryDelayMs(current.cadenceMs, null));
    } finally {
      inflight = false;
    }
  }

  return {
    start: load,
    load,
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
      clearTimer();
      dueAt = null;
    },
  };
}
