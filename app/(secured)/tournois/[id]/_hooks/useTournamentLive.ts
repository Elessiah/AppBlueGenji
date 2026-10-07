import { useCallback, useEffect, useRef, useState } from "react";
import type { TournamentDetail } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { useFrenchBlockToast, useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { REFRESH_CADENCE } from "@/lib/shared/refresh-tiers";
import { mapError } from "../_lib/error-map";
import { clearAttention } from "../_lib/attention";
import {
  nextViewerMatchFocusChangeAt,
  powerPolicy,
  viewerMatchFocus,
  type ClientPowerInput,
  type ClientPowerPolicy,
} from "@/lib/shared/client-power";
import {
  getClientPowerInput,
  subscribeClientPower,
  useMatchFocusLease,
} from "@/lib/shared/hooks/useClientPower";
import {
  applyLiveMessage,
  fatalFailure,
  INITIAL_LIVE_STATE,
  shareUnchanged,
  shouldCommitFetched,
  shouldRefreshViewerContext,
  type LiveFailure,
  type LiveMessage,
  type LiveState,
} from "../_lib/live-state";
import { announceViewerChanges } from "../_lib/live-alerts";
import { openLiveConnection } from "../_lib/live-connection";
import { createLiveRenderGate, createQuietStream } from "../_lib/live-render-gate";

/** Plafond d'un `setTimeout` (~24,8 jours) : au-delà, il se déclencherait tout de suite. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Point de départ du régime, avant la première lecture du magasin. */
const FULL_POWER_INPUT: ClientPowerInput = { attention: "FOCUSED", matchFocus: false };

/**
 * Suivi en direct d'un tournoi.
 *
 * Le flux SSE **porte la donnée** : il envoie l'instantané complet à la
 * connexion, puis chaque nouvelle version. Dans le cas nominal, la page ne fait
 * donc aucune requête REST — ni au chargement, ni pendant le tournoi. C'est ce
 * qui permet à cent spectateurs de suivre un plateau sans que le serveur ne
 * calcule cent fois la même chose.
 *
 * Le hook assemble trois pièces, chacune dans son module :
 * - la **connexion** (`_lib/live-connection.ts`) — reconnexion sans abandon,
 *   échec définitif, retour sur l'onglet, sondage de secours et guet du premier
 *   instantané ;
 * - le **régime de charge** (`_lib/live-render-gate.ts`) — ce qui est *reçu* et
 *   ce qui est *rendu* sont deux choses, et un onglet caché depuis une minute,
 *   hors match, rouvre le flux au palier spectateur (`?quiet=1`) ;
 * - les **annonces** au lecteur (`_lib/live-alerts.ts`) — signal sonore, titre
 *   d'onglet, modale de lancement.
 */
export function useTournamentLive(tournamentId: number) {
  // Refus d'une relecture : phrase de `mapError`, française (`lang="fr"` sous
  // `/en`). Échec définitif : dit dans la langue de la page, comme le témoin.
  const { showError } = useFrenchBlockToast();
  const { showError: showPageError } = useToast();
  const { t } = useTournamentPageText();
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

  /**
   * Régime de charge, suivi **sans rendu** : lu dans des refs et des minuteurs
   * seulement. Par le hook `useClientPower`, chaque alt-tab re-rendrait la page — et
   * avec elle l'arbre entier du plateau —, exactement le coût qu'on retire ici.
   * Part du régime complet : la souscription corrige dès le montage.
   */
  const policyRef = useRef<ClientPowerPolicy>(powerPolicy(FULL_POWER_INPUT));
  /** Rendu du dernier état reçu, selon le régime. */
  const [renderGate] = useState(() =>
    createLiveRenderGate(() => {
      setState(stateRef.current);
      return stateRef.current;
    }),
  );
  /** Palier spectateur du flux. */
  const [quietStream] = useState(() => createQuietStream(() => reconnectRef.current?.()));

  /** Le lecteur a une rencontre en cours — lu sur l'état reçu, pas sur le rendu. */
  const [matchFocus, setMatchFocus] = useState(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMatchFocusLease(matchFocus);

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

      // Détecté sur ce qui est **reçu**, avant de décider du rendu.
      if (next.detail) announceViewerChanges(previous.detail, next.detail, (alert) => t(`live.alerts.${alert}`));
      updateMatchFocus();

      renderGate.received(policyRef.current.snapshotRenderDelayMs, previous.detail, next.detail);
    },
    [renderGate, updateMatchFocus, t],
  );

  useEffect(() => {
    const apply = () => {
      const previous = policyRef.current;
      const next = powerPolicy(getClientPowerInput());
      policyRef.current = next;
      renderGate.policyChanged(next.snapshotRenderDelayMs);
      quietStream.policyChanged(previous.quietStreamAfterMs, next.quietStreamAfterMs);
    };

    const unsubscribe = subscribeClientPower(apply);
    apply();
    return () => {
      unsubscribe();
      quietStream.dispose();
    };
  }, [renderGate, quietStream]);

  // Au démontage : aucun minuteur ni titre d'appel ne survit à la page.
  useEffect(
    () => () => {
      renderGate.dispose();
      if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
      clearAttention();
    },
    [renderGate],
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

        const current = stateRef.current.detail;
        if (!shouldCommitFetched(current, payload, force)) return null;
        // Même partage structurel que pour le flux : une relecture ne doit pas
        // redessiner les cartes qu'elle n'a pas changées.
        const detail = current ? { ...payload, ...shareUnchanged(current, payload) } : payload;
        commit({ tier: stateRef.current.tier, detail });
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

  /**
   * Repart de zéro quand on change de tournoi.
   *
   * L'App Router réutilise ce composant d'un paramètre à l'autre : passer de
   * `/tournois/1` à `/tournois/2` ne le remonte pas. Sans cette remise à zéro,
   * l'échec définitif du tournoi précédent condamnerait le suivant, son plateau
   * s'afficherait un instant sous la mauvaise URL — pastille « Direct »
   * comprise — et la comparaison des deux détails ferait sonner le signal
   * « score à confirmer » sur une simple navigation. Même remise à zéro pour
   * le régime de charge : un rendu en attente, un match en cours ou un titre
   * d'appel du tournoi précédent n'ont rien à faire ici.
   */
  useEffect(() => {
    renderGate.reset();
    if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    quietStream.reset();
    clearAttention();
    setMatchFocus(false);
    stateRef.current = INITIAL_LIVE_STATE;
    lastUpdateAtRef.current = 0;
    lastFetchAtRef.current = 0;
    setState(INITIAL_LIVE_STATE);
    setIsLive(false);
    setFatal(null);
  }, [tournamentId, renderGate, quietStream]);

  /**
   * Message du flux : intégré tout de suite, puis — pour qui en a un — aperçu
   * du plateau relu quand il a bougé.
   */
  const onMessage = useCallback(
    (message: LiveMessage) => {
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
    },
    [commit, load],
  );

  useEffect(() => {
    if (!tournamentId) return;

    const connection = openLiveConnection({
      tournamentId,
      quiet: quietStream.isQuiet,
      hasDetail: () => Boolean(stateRef.current.detail),
      fallbackPeriodMs: () => REFRESH_CADENCE[stateRef.current.tier].detailFallbackMs,
      lastUpdateAt: () => lastUpdateAtRef.current,
      lastFetchAt: () => lastFetchAtRef.current,
      load: (silent) => load(silent),
      onMessage,
      onLiveChange: setIsLive,
      onFatal: (failure) => {
        setFatal(failure);
        showPageError(t(`live.fatal.${failure}`));
      },
    });
    reconnectRef.current = connection.reconnect;

    return () => {
      reconnectRef.current = null;
      connection.close();
    };
  }, [tournamentId, load, onMessage, showPageError, t, quietStream]);

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
