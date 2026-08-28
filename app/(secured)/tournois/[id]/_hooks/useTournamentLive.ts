import { useCallback, useEffect, useRef, useState } from "react";
import type { TournamentDetail } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { REFRESH_CADENCE, FOCUS_REFRESH_MIN_INTERVAL_MS } from "@/lib/shared/refresh-tiers";
import { mapError } from "../_lib/error-map";
import { playScoreReady } from "../_lib/sounds";
import {
  applyLiveMessage,
  fatalFailure,
  INITIAL_LIVE_STATE,
  parseLiveMessage,
  reconnectDelayMs,
  shouldPlayScoreReady,
  type LiveFailure,
  type LiveState,
} from "../_lib/live-state";

/**
 * Suivi en direct d'un tournoi.
 *
 * Le flux SSE **porte la donnée** : il envoie l'instantané complet à la
 * connexion, puis chaque nouvelle version. Dans le cas nominal, la page ne fait
 * donc aucune requête REST — ni au chargement, ni pendant le tournoi. C'est ce
 * qui permet à cent spectateurs de suivre un plateau sans que le serveur ne
 * calcule cent fois la même chose.
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
 *    cadence du palier accordé par le serveur.
 */
export function useTournamentLive(tournamentId: number) {
  const { showError } = useToast();
  const [state, setState] = useState<LiveState>(INITIAL_LIVE_STATE);
  const [isLive, setIsLive] = useState(false);
  /** Échec dont on ne se relèvera pas seul (session expirée, tournoi supprimé). */
  const [fatal, setFatal] = useState<LiveFailure | null>(null);

  // Refs plutôt qu'états : ces valeurs pilotent les minuteurs, elles ne doivent
  // pas provoquer de rendu ni relancer l'effet.
  const stateRef = useRef<LiveState>(INITIAL_LIVE_STATE);
  const lastUpdateAtRef = useRef(0);
  const lastFetchAtRef = useRef(0);
  /** Rouvre le flux. Renseigné par l'effet, remis à null au démontage. */
  const reconnectRef = useRef<(() => void) | null>(null);

  const commit = useCallback((next: LiveState) => {
    const previous = stateRef.current;
    if (next === previous) return;

    stateRef.current = next;
    lastUpdateAtRef.current = Date.now();
    setState(next);

    if (next.detail && shouldPlayScoreReady(previous.detail, next.detail)) {
      playScoreReady();
    }
  }, []);

  /**
   * Lecture REST. Chemin de secours uniquement : le flux se suffit à lui-même.
   * `silent` tait la notification d'erreur des rafraîchissements automatiques —
   * un incident réseau passager n'a pas à couvrir l'écran d'alertes.
   */
  const load = useCallback(
    async (silent = false): Promise<LiveFailure | null> => {
      lastFetchAtRef.current = Date.now();
      try {
        const response = await fetch(`/api/tournaments/${tournamentId}`, { cache: "no-store" });
        const payload = (await response.json()) as TournamentDetail & { error?: string };

        if (!response.ok) {
          // Le flux SSE, lui, ne dit jamais pourquoi il tombe : c'est cette
          // lecture qui distingue l'incident passager de l'échec définitif.
          const failure = fatalFailure(response.status);
          if (failure) return failure;
          throw new Error(payload.error || "TOURNAMENT_LOAD_FAILED");
        }

        // Même déduplication que le chemin SSE : sans elle, chaque sondage de
        // secours redessinerait l'arbre entier — 254 matchs sur un gros
        // plateau — alors que rien n'a bougé.
        if (payload.version && payload.version === stateRef.current.detail?.version) return null;
        commit({ tier: stateRef.current.tier, detail: payload });
        return null;
      } catch (e) {
        if (!silent) showError(mapError((e as Error).message));
        return null;
      }
    },
    [tournamentId, commit, showError],
  );

  /**
   * Relit immédiatement après une action de l'utilisateur (score, inscription,
   * abandon).
   *
   * Deux raisons de ne pas simplement attendre le flux : celui qui agit mérite
   * un retour immédiat quel que soit son palier, et son **contexte de lecteur**
   * a pu changer — s'inscrire fait passer prioritaire, ce que seul le serveur
   * peut acter, à la connexion. On ne rouvre donc le flux que dans ce cas.
   */
  const refresh = useCallback(async () => {
    const before = stateRef.current.detail?.myTeamId ?? null;
    await load(true);

    if ((stateRef.current.detail?.myTeamId ?? null) !== before) {
      reconnectRef.current?.();
    }
  }, [load]);

  useEffect(() => {
    if (!tournamentId) return;

    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
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
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source?.close();
      source = null;
      setIsLive(false);
      setFatal(failure);
      showError(mapError(failure));
    };

    const stopFallback = () => {
      if (fallbackTimer !== null) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    /** Sondage de secours, tant que le flux est coupé. */
    const startFallback = () => {
      if (fallbackTimer !== null || stopped) return;
      const period = REFRESH_CADENCE[stateRef.current.tier].detailFallbackMs;
      fallbackTimer = setInterval(() => {
        if (cancelled || stopped || document.visibilityState === "hidden") return;
        void load(true).then((failure) => {
          if (failure && !cancelled) giveUp(failure);
        });
      }, period);
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
        source = new EventSource(`/api/tournaments/${tournamentId}/stream`);
      } catch {
        startFallback();
        scheduleReconnect();
        return;
      }

      source.onopen = () => {
        if (cancelled) return;
        attempts = 0;
        setIsLive(true);
        stopFallback();
      };

      source.onmessage = (event) => {
        if (cancelled) return;
        const message = parseLiveMessage(event.data);
        if (!message) return;
        // Le premier message porte déjà tout : la connexion vaut chargement.
        setIsLive(true);
        commit(applyLiveMessage(stateRef.current, message));
      };

      source.onerror = () => {
        if (cancelled) return;
        source?.close();
        source = null;
        setIsLive(false);
        // La page ne doit pas rester vide si le flux échoue d'entrée (session
        // expirée, tournoi introuvable, plafond de flux atteint).
        if (!stateRef.current.detail) {
          void load(attempts > 0).then((failure) => {
            if (failure && !cancelled) giveUp(failure);
          });
        }
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
      const stale = now - lastUpdateAtRef.current > FOCUS_REFRESH_MIN_INTERVAL_MS;
      const recentlyFetched = now - lastFetchAtRef.current < FOCUS_REFRESH_MIN_INTERVAL_MS;
      if (!source && stale && !recentlyFetched) void load(true);

      if (!source && reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        attempts = 0;
        connect();
      }
    };

    reconnectRef.current = () => {
      if (cancelled || stopped) return;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source?.close();
      source = null;
      attempts = 0;
      connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      reconnectRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      stopFallback();
      source?.close();
      setIsLive(false);
    };
  }, [tournamentId, load, commit, showError]);

  return {
    tournament: state.detail,
    matches: state.detail?.matches ?? [],
    isLive,
    /**
     * Échec définitif : la page a cessé de réessayer. `UNAUTHORIZED` invite à se
     * reconnecter, `TOURNAMENT_NOT_FOUND` dit que le tournoi n'existe plus.
     */
    fatal,
    /** Palier de fraîcheur accordé par le serveur (`lib/shared/refresh-tiers`). */
    tier: state.tier,
    /** À appeler après une action de l'utilisateur, pour un retour immédiat. */
    refresh,
  };
}
