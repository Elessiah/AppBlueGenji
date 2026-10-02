import { FOCUS_REFRESH_MIN_INTERVAL_MS } from "@/lib/shared/refresh-tiers";
import {
  FIRST_SNAPSHOT_TIMEOUT_MS,
  parseLiveMessage,
  reconnectDelayMs,
  type LiveFailure,
  type LiveMessage,
} from "./live-state";

/**
 * Ce que la connexion lit et rend au hook (`useTournamentLive`). Les lectures
 * passent par des fonctions : elles sont faites au moment où la connexion en a
 * besoin, jamais figées à l'ouverture.
 */
export type LiveConnectionOptions = {
  tournamentId: number;
  /** Flux au palier spectateur (`?quiet=1`), relu à chaque ouverture. */
  quiet: () => boolean;
  /** Un instantané a-t-il déjà été reçu ? */
  hasDetail: () => boolean;
  /** Période du sondage de secours, lue au moment où il s'arme. */
  fallbackPeriodMs: () => number;
  /** Instant de la dernière donnée reçue (`Date.now()`). */
  lastUpdateAt: () => number;
  /** Instant de la dernière lecture REST (`Date.now()`). */
  lastFetchAt: () => number;
  /**
   * Lecture REST de secours. `silent` tait la notification d'erreur ; un
   * échec **définitif** est rendu plutôt que levé.
   */
  load: (silent: boolean) => Promise<LiveFailure | null>;
  /** Message exploitable du flux, déjà analysé. */
  onMessage: (message: LiveMessage) => void;
  /** Témoin « À jour » / « Reconnexion… ». */
  onLiveChange: (live: boolean) => void;
  /** Échec dont on ne se relèvera pas : la connexion a cessé de réessayer. */
  onFatal: (failure: LiveFailure) => void;
};

export type LiveConnection = {
  /** Rouvre le flux tout de suite (palier changé, engagement changé). */
  reconnect: () => void;
  /** Ferme tout : flux, minuteurs, écouteurs. */
  close: () => void;
};

/**
 * Connexion au flux SSE d'un tournoi (`docs/features/REALTIME_REFRESH.md`).
 *
 * Quatre filets de sécurité, dans cet ordre :
 * 1. **reconnexion sans abandon** — attente exponentielle plafonnée avec gigue,
 *    indéfiniment. L'ancienne version renonçait après cinq essais et laissait la
 *    page figée : il ne restait que le F5 ;
 * 2. **sauf échec définitif** — une session expirée ou un tournoi supprimé ne
 *    passeront pas tout seuls. Réessayer indéfiniment laisserait la page sur
 *    « Reconnexion… » pour l'éternité, sans jamais dire quoi faire : la boucle
 *    s'arrête alors et l'utilisateur est prévenu ;
 * 3. **retour sur l'onglet** — reprendre la main relit la donnée si elle a
 *    vieilli, ce qui remplace le réflexe de recharger ;
 * 4. **sondage de secours** — uniquement tant que le flux est coupé, à la
 *    cadence du palier accordé par le serveur — ou tant qu'un flux **ouvert**
 *    n'a livré aucun instantané (`FIRST_SNAPSHOT_TIMEOUT_MS` : réponse mise en
 *    tampon par un proxy, qui ne déclare aucune erreur).
 */
export function openLiveConnection(options: LiveConnectionOptions): LiveConnection {
  const { tournamentId, load } = options;

  let cancelled = false;
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  /** Guette le premier instantané d'un flux ouvert (`FIRST_SNAPSHOT_TIMEOUT_MS`). */
  let firstSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;

  /**
   * Un échec dont on ne se relèvera pas : on cesse de réessayer et on le dit.
   * Sans cela la page resterait indéfiniment sur « Reconnexion… », à ouvrir un
   * flux qui refusera toujours, sans jamais orienter vers `/connexion`.
   */
  const giveUp = (failure: LiveFailure) => {
    if (stopped) return;
    stopped = true;
    stopFallback();
    stopFirstSnapshotWatch();
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    source?.close();
    source = null;
    options.onLiveChange(false);
    options.onFatal(failure);
  };

  /** Lecture REST dont un échec définitif arrête tout. */
  const loadOrGiveUp = (silent: boolean) => {
    void load(silent).then((failure) => {
      if (failure && !cancelled) giveUp(failure);
    });
  };

  const stopFallback = () => {
    if (fallbackTimer !== null) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const stopFirstSnapshotWatch = () => {
    if (firstSnapshotTimer !== null) {
      clearTimeout(firstSnapshotTimer);
      firstSnapshotTimer = null;
    }
  };

  /**
   * Flux ouvert, page encore vide : si rien n'arrive dans le délai, la donnée
   * est lue par REST et le sondage de secours prend le relais. Le flux reste
   * ouvert — un premier message tardif coupe le sondage et reprend la main.
   */
  const watchFirstSnapshot = () => {
    stopFirstSnapshotWatch();
    if (options.hasDetail()) return;
    firstSnapshotTimer = setTimeout(() => {
      firstSnapshotTimer = null;
      if (cancelled || stopped || options.hasDetail()) return;
      // Le témoin dit ce qui est : ce flux ne livre rien.
      options.onLiveChange(false);
      loadOrGiveUp(true);
      startFallback();
    }, FIRST_SNAPSHOT_TIMEOUT_MS);
  };

  /** Sondage de secours, tant que le flux est coupé. */
  const startFallback = () => {
    if (fallbackTimer !== null || stopped) return;
    fallbackTimer = setInterval(() => {
      if (cancelled || stopped || document.visibilityState === "hidden") return;
      loadOrGiveUp(true);
    }, options.fallbackPeriodMs());
  };

  const scheduleReconnect = () => {
    if (cancelled || stopped || reconnectTimer !== null) return;
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs(attempts));
  };

  const connect = () => {
    if (cancelled || stopped) return;

    try {
      const quiet = options.quiet() ? "?quiet=1" : "";
      source = new EventSource(`/api/tournaments/${tournamentId}/stream${quiet}`);
    } catch {
      startFallback();
      scheduleReconnect();
      return;
    }

    source.onopen = () => {
      if (cancelled) return;
      attempts = 0;
      options.onLiveChange(true);
      stopFallback();
      watchFirstSnapshot();
    };

    source.onmessage = (event) => {
      if (cancelled) return;
      const message = parseLiveMessage(event.data);
      if (!message) return;
      // Le premier message porte déjà tout : la connexion vaut chargement.
      // Il lève aussi le guet et le sondage qu'un flux muet avait armés.
      options.onLiveChange(true);
      stopFirstSnapshotWatch();
      stopFallback();
      options.onMessage(message);
    };

    source.onerror = () => {
      if (cancelled) return;
      stopFirstSnapshotWatch();
      source?.close();
      source = null;
      options.onLiveChange(false);
      // La page ne doit pas rester vide si le flux échoue d'entrée (session
      // expirée, tournoi introuvable, plafond de flux atteint).
      if (!options.hasDetail()) loadOrGiveUp(attempts > 0);
      startFallback();
      scheduleReconnect();
    };
  };

  /**
   * Retour sur l'onglet : c'est le moment où l'on rechargeait la page à la
   * main. On relit si la donnée a vieilli, et on retente tout de suite une
   * connexion plutôt que d'attendre la fin de l'attente en cours.
   */
  const onVisible = () => {
    if (cancelled || stopped || document.visibilityState !== "visible") return;

    // Tant que le flux tient, la donnée est déjà à jour : la relire ferait
    // repartir, à la fin d'une manche, la centaine de requêtes simultanées
    // que ce flux existe précisément pour éviter. On ne relit donc que
    // lorsqu'il est coupé.
    const now = Date.now();
    const stale = now - options.lastUpdateAt() > FOCUS_REFRESH_MIN_INTERVAL_MS;
    const recentlyFetched = now - options.lastFetchAt() < FOCUS_REFRESH_MIN_INTERVAL_MS;
    if (!source && stale && !recentlyFetched) void load(true);

    if (!source && reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      attempts = 0;
      connect();
    }
  };

  const reconnect = () => {
    if (cancelled || stopped) return;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopFirstSnapshotWatch();
    source?.close();
    source = null;
    attempts = 0;
    connect();
  };

  const close = () => {
    cancelled = true;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    stopFallback();
    stopFirstSnapshotWatch();
    source?.close();
    options.onLiveChange(false);
  };

  connect();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);

  return { reconnect, close };
}
