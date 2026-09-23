import { useCallback, useEffect, useRef, useState } from "react";
import type { TournamentDetail } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { REFRESH_CADENCE, FOCUS_REFRESH_MIN_INTERVAL_MS } from "@/lib/shared/refresh-tiers";
import { mapError } from "../_lib/error-map";
import { playAlertChime } from "../_lib/sounds";
import { clearAttention, raiseAttention } from "../_lib/attention";
import { isPersonalAlert, touchesViewerMatches, viewerAlert } from "@/lib/shared/viewer-alerts";
import { nextViewerMatchFocusChangeAt, viewerMatchFocus } from "@/lib/shared/client-power";
import { useClientPower, useMatchFocusLease } from "@/lib/shared/hooks/useClientPower";
import {
  applyLiveMessage,
  fatalFailure,
  INITIAL_LIVE_STATE,
  parseLiveMessage,
  reconnectDelayMs,
  shouldCommitFetched,
  shouldRefreshViewerContext,
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
 *
 * Et une règle de sobriété, le **régime de charge** (`lib/shared/client-power.ts`) :
 * ce qui est *reçu* et ce qui est *rendu* sont deux choses. Tout instantané est
 * intégré sur-le-champ — c'est sur lui qu'on détecte « ton match est prêt »,
 * qu'on sonne et qu'on écrit le titre d'onglet —, mais il n'est **rendu** que si
 * quelqu'un peut le voir : tout de suite quand la page est regardée ou sur un
 * second écran, regroupé toutes les cinq secondes pour un joueur en match qui
 * regarde son jeu (sauf ce qui touche son propre match), et pas avant le retour
 * quand l'onglet est caché. Redessiner l'arbre d'un gros plateau à chaque score
 * d'un autre match, c'était prendre au jeu du joueur des images par dizaines.
 *
 * Onglet caché depuis une minute, hors match : le flux est rouvert au palier
 * spectateur (`?quiet=1`). Les annonces arrivent encore — à la cadence des
 * spectateurs —, et le budget de sortie de la salle revient à ceux qui jouent.
 */
/** Plafond d'un `setTimeout` (~24,8 jours) : au-delà, il se déclencherait tout de suite. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function useTournamentLive(tournamentId: number) {
  const { showError } = useToast();
  /** État **rendu** — peut retarder sur `stateRef`, qui est l'état reçu. */
  const [state, setState] = useState<LiveState>(INITIAL_LIVE_STATE);
  const [isLive, setIsLive] = useState(false);
  /** Échec dont on ne se relèvera pas seul (session expirée, tournoi supprimé). */
  const [fatal, setFatal] = useState<LiveFailure | null>(null);

  // Refs plutôt qu'états : ces valeurs pilotent les minuteurs, elles ne doivent
  // pas provoquer de rendu ni relancer l'effet.
  /** Dernier état **reçu** : la source de vérité, rendue ou non. */
  const stateRef = useRef<LiveState>(INITIAL_LIVE_STATE);
  const lastUpdateAtRef = useRef(0);
  const lastFetchAtRef = useRef(0);
  /** Rouvre le flux. Renseigné par l'effet, remis à null au démontage. */
  const reconnectRef = useRef<(() => void) | null>(null);

  const policy = useClientPower();
  const policyRef = useRef(policy);
  policyRef.current = policy;
  /** Un état reçu attend d'être rendu. */
  const pendingRenderRef = useRef(false);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Flux ouvert au palier spectateur (`?quiet=1`). */
  const quietRef = useRef(false);

  /** Le lecteur a une rencontre en cours — lu sur l'état reçu, pas sur le rendu. */
  const [matchFocus, setMatchFocus] = useState(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMatchFocusLease(matchFocus);

  /** Rend le dernier état reçu. */
  const flushRender = useCallback(() => {
    pendingRenderRef.current = false;
    if (renderTimerRef.current !== null) {
      clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }
    setState(stateRef.current);
  }, []);

  /**
   * Réévalue le régime `MATCH` sur l'état reçu, et se réveille seul à l'approche
   * d'un horaire annoncé — le seul changement qu'aucun instantané n'apporte.
   */
  const updateMatchFocus = useCallback(function update() {
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    const detail = stateRef.current.detail;
    const now = Date.now();
    setMatchFocus(viewerMatchFocus(detail, now));
    const at = nextViewerMatchFocusChangeAt(detail, now);
    if (at !== null) {
      focusTimerRef.current = setTimeout(update, Math.min(at - now, MAX_TIMEOUT_MS));
    }
  }, []);

  const commit = useCallback(
    (next: LiveState) => {
      const previous = stateRef.current;
      if (next === previous) return;

      stateRef.current = next;
      lastUpdateAtRef.current = Date.now();

      // Détecté sur ce qui est **reçu** : l'annonce part même quand rien n'est
      // rendu — c'est justement quand le lecteur ne regarde pas qu'elle sert.
      if (next.detail) {
        const alert = viewerAlert(previous.detail, next.detail);
        if (alert) {
          if (isPersonalAlert(alert)) playAlertChime(alert);
          raiseAttention(alert);
        }
      }
      updateMatchFocus();

      const delay = policyRef.current.snapshotRenderDelayMs;
      if (delay === 0) {
        flushRender();
        return;
      }
      pendingRenderRef.current = true;
      // Onglet caché : rien avant le retour (l'effet sur le régime s'en charge).
      if (delay === null) return;
      // Le match du lecteur ne se regroupe pas : c'est ce qu'il regarde.
      const urgent =
        !previous.detail || !next.detail || touchesViewerMatches(previous.detail, next.detail);
      if (urgent) {
        flushRender();
        return;
      }
      if (renderTimerRef.current === null) {
        renderTimerRef.current = setTimeout(flushRender, delay);
      }
    },
    [flushRender, updateMatchFocus],
  );

  // Changement de régime : ce qui attendait est rendu dès qu'on peut le voir.
  const renderDelay = policy.snapshotRenderDelayMs;
  useEffect(() => {
    if (!pendingRenderRef.current) return;
    if (renderDelay === 0) flushRender();
    else if (renderDelay !== null && renderTimerRef.current === null) {
      renderTimerRef.current = setTimeout(flushRender, renderDelay);
    }
  }, [renderDelay, flushRender]);

  // Palier spectateur pour un onglet caché hors match ; palier normal au retour.
  const quietAfter = policy.quietStreamAfterMs;
  useEffect(() => {
    if (quietAfter === null) {
      if (quietRef.current) {
        quietRef.current = false;
        reconnectRef.current?.();
      }
      return;
    }
    const timer = setTimeout(() => {
      quietRef.current = true;
      reconnectRef.current?.();
    }, quietAfter);
    return () => clearTimeout(timer);
  }, [quietAfter]);

  // Au démontage : aucun minuteur ni titre d'appel ne survit à la page.
  useEffect(
    () => () => {
      if (renderTimerRef.current !== null) clearTimeout(renderTimerRef.current);
      if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
      clearAttention();
    },
    [],
  );

  /**
   * Lecture REST. Chemin de secours uniquement : le flux se suffit à lui-même.
   * `silent` tait la notification d'erreur des rafraîchissements automatiques —
   * un incident réseau passager n'a pas à couvrir l'écran d'alertes.
   *
   * `force` dit qu'on vient chercher le **contexte du lecteur**, dont la charge
   * peut parfaitement porter une version d'instantané déjà connue — c'est même
   * le cas nominal. `shouldCommitFetched` tranche.
   */
  const load = useCallback(
    async (silent = false, force = false): Promise<LiveFailure | null> => {
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

        if (!shouldCommitFetched(stateRef.current.detail, payload, force)) return null;
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
    // `force` : l'instantané poussé par le flux peut avoir devancé cette
    // lecture, et c'est le contexte du lecteur — droits de report, aperçu —
    // qu'on vient rafraîchir.
    await load(true, true);

    if ((stateRef.current.detail?.myTeamId ?? null) !== before) {
      reconnectRef.current?.();
    }
  }, [load]);

  // Même remise à zéro pour le régime de charge : un rendu en attente, un match
  // en cours ou un titre d'appel du tournoi précédent n'ont rien à faire ici.
  useEffect(() => {
    pendingRenderRef.current = false;
    if (renderTimerRef.current !== null) {
      clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    quietRef.current = false;
    clearAttention();
    setMatchFocus(false);
  }, [tournamentId]);

  /**
   * Repart de zéro quand on change de tournoi.
   *
   * L'App Router réutilise ce composant d'un paramètre à l'autre : passer de
   * `/tournois/1` à `/tournois/2` ne le remonte pas. Sans cette remise à zéro,
   * l'échec définitif du tournoi précédent condamnerait le suivant, son plateau
   * s'afficherait un instant sous la mauvaise URL — pastille « Direct »
   * comprise — et la comparaison des deux détails ferait sonner le signal
   * « score à confirmer » sur une simple navigation.
   */
  useEffect(() => {
    stateRef.current = INITIAL_LIVE_STATE;
    lastUpdateAtRef.current = 0;
    lastFetchAtRef.current = 0;
    setState(INITIAL_LIVE_STATE);
    setIsLive(false);
    setFatal(null);
  }, [tournamentId]);

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
        const quiet = quietRef.current ? "?quiet=1" : "";
        source = new EventSource(`/api/tournaments/${tournamentId}/stream${quiet}`);
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

        // Le contexte du lecteur n'arrive qu'à la connexion — sauf l'aperçu du
        // plateau, qui se périme à chaque inscription. On ne le redemande que
        // pour ceux qui en ont un, et seulement quand il a bougé.
        const previous = stateRef.current.detail;
        const stalePreview =
          message.type === "snapshot" &&
          previous !== null &&
          shouldRefreshViewerContext(previous, message.snapshot);

        commit(applyLiveMessage(stateRef.current, message));
        // `force` : on vient de commiter cette version, la déduplication par
        // version rejetterait la relecture avant d'en avoir pris l'aperçu.
        if (stalePreview) void load(true, true);
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
    /**
     * Le lecteur a une rencontre en cours (régime `MATCH`,
     * `lib/shared/client-power.ts`) — lu sur le dernier état reçu.
     */
    matchFocus,
    matches: state.detail?.matches ?? [],
    isLive,
    /**
     * Échec définitif : la page a cessé de réessayer. `UNAUTHORIZED` invite à se
     * reconnecter, `TOURNAMENT_NOT_FOUND` dit que le tournoi n'existe plus.
     */
    fatal,
    /** Palier de fraîcheur accordé par le serveur (`lib/shared/refresh-tiers`). */
    tier: state.tier,
    /**
     * Recharge à la demande, après une action de l'utilisateur : le flux couvre
     * le cas nominal, mais celui qui vient d'agir mérite un retour immédiat quel
     * que soit son palier — et son contexte de lecteur a pu changer.
     *
     * Remplace le `reload` d'avant, qui exposait `load` tel quel : la relecture
     * doit forcer la prise du contexte du lecteur (la version de l'instantané
     * étant souvent déjà connue) et rouvrir le flux quand l'engagement change.
     */
    refresh,
  };
}
