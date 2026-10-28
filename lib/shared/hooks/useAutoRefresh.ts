"use client";

import { useEffect, useRef } from "react";
import { FOCUS_REFRESH_MIN_INTERVAL_MS } from "@/lib/shared/refresh-tiers";

/**
 * Ce que rend un rafraîchissement : `"RETRY"` quand il n'a pas pu trancher
 * (réseau pas encore revenu, panne) — il est alors retenté **une** fois, au
 * retour du réseau ou du focus, sans attendre le délai minimal.
 */
export type AutoRefreshOutcome = void | "RETRY";

type AutoRefreshOptions = {
  /**
   * Période du rafraîchissement de fond, en millisecondes ; `null` : aucune
   * période, seuls les retours sur l'onglet et du réseau relisent. Une valeur
   * nulle ou négative désactive tout.
   */
  intervalMs: number | null;
  /** Désactive tout (page sans donnée à rafraîchir, chargement initial en cours). */
  enabled?: boolean;
  /**
   * Délai minimal entre deux rafraîchissements déclenchés par le retour sur
   * l'onglet. Évite qu'un va-et-vient entre deux onglets ne mitraille le
   * serveur.
   */
  focusMinIntervalMs?: number;
  /** Un retour par le cache avant/arrière (`pageshow`) compte comme un retour sur l'onglet. */
  pageShow?: boolean;
  /**
   * Dernière lecture de la même donnée faite **hors** du hook (horodatage) :
   * un retour sur l'onglet n'en relance pas une avant le délai minimal.
   */
  freshAt?: { readonly current: number };
  /** Relit dès l'activation si le délai minimal est passé (fenêtre qui réapparaît). */
  runOnEnable?: boolean;
};

/**
 * Rafraîchissement de fond d'une liste, à la place du F5.
 *
 * Trois déclencheurs, dans l'ordre d'importance réelle :
 *
 * 1. **le retour sur l'onglet** — c'est le geste que remplace ce hook. On
 *    revient sur la page, la donnée est à jour ; il n'y a plus de raison de
 *    recharger ;
 * 2. **le retour du réseau** ;
 * 3. **une période de fond**, ajustée au palier du lecteur
 *    (`lib/shared/refresh-tiers.ts`) — facultative (`intervalMs: null`).
 *
 * Trois garde-fous qui comptent autant que le reste : rien ne part quand
 * l'onglet est caché — cent onglets oubliés ne doivent rien coûter —, les
 * déclenchements par focus sont étranglés, et le rappel reçoit un
 * `AbortSignal` qui lui permet d'abandonner sa requête au démontage. Un
 * rappel qui rend `"RETRY"` est retenté une fois (`online`, `focus`).
 */
export function useAutoRefresh(
  refresh: (signal: AbortSignal) => AutoRefreshOutcome | Promise<AutoRefreshOutcome>,
  {
    intervalMs,
    enabled = true,
    focusMinIntervalMs = FOCUS_REFRESH_MIN_INTERVAL_MS,
    pageShow = false,
    freshAt,
    runOnEnable = false,
  }: AutoRefreshOptions,
): void {
  // `refresh` est relu à chaque déclenchement : une fonction recréée à chaque
  // rendu ne doit pas relancer le minuteur.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastRunAtRef = useRef(0);
  const freshAtRef = useRef(freshAt);
  freshAtRef.current = freshAt;

  useEffect(() => {
    if (!enabled || (intervalMs !== null && intervalMs <= 0)) return;

    // Un rafraîchissement en vol est abandonné au démontage — et par le
    // suivant : sans cela, une réponse tardive écraserait une plus fraîche, et
    // continuerait de consommer un lien déjà contraint pour une page que
    // personne ne regarde plus.
    let controller: AbortController | null = null;
    /** Le dernier rafraîchissement n'a pas tranché : une reprise est due. */
    let retry = false;

    const run = (retrying: boolean) => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      retry = false;
      lastRunAtRef.current = Date.now();
      void Promise.resolve(refreshRef.current(current.signal)).then(
        (outcome) => {
          if (outcome === "RETRY" && !retrying && controller === current && !current.signal.aborted) retry = true;
        },
        () => undefined,
      );
    };

    const sinceLastRead = () => Date.now() - Math.max(lastRunAtRef.current, freshAtRef.current?.current ?? 0);

    const interval =
      intervalMs === null
        ? null
        : setInterval(() => {
            if (document.visibilityState === "hidden") return;
            run(false);
          }, intervalMs);

    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (sinceLastRead() >= focusMinIntervalMs) run(false);
      else if (retry) run(true);
    };
    const onRetry = () => {
      if (retry && document.visibilityState === "visible") run(true);
    };

    if (runOnEnable && document.visibilityState === "visible" && sinceLastRead() >= focusMinIntervalMs) run(false);

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onRetry);
    if (pageShow) window.addEventListener("pageshow", onWake);

    return () => {
      controller?.abort();
      if (interval !== null) clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onRetry);
      if (pageShow) window.removeEventListener("pageshow", onWake);
    };
  }, [enabled, intervalMs, focusMinIntervalMs, pageShow, runOnEnable]);
}
