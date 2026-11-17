"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { browserAudienceOptOut } from "@/components/visit-tracker";
import { AUDIENCE_CLIENT_FLUSH_MS, deviceFromWidth, type AudienceBeaconEntry } from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";
import { powerPolicy } from "@/lib/shared/client-power";
import { getClientPowerInput, subscribeClientPower } from "@/lib/shared/hooks/useClientPower";

/** Nom d'hôte du référent s'il est extérieur au site, sinon `null` (jamais son chemin). */
function externalReferrerHost(): string | null {
  try {
    if (!document.referrer) return null;
    const host = new URL(document.referrer).host;
    return host && host !== window.location.host ? host : null;
  } catch {
    return null;
  }
}

function send(entries: AudienceBeaconEntry[]): void {
  // Opposition exprimée depuis le chargement (bouton de `/rgpd#audience`) : plus rien ne part.
  if (browserAudienceOptOut()) return;
  fetch("/api/audience", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: entries }),
    keepalive: true,
    // `Referer` réduit à l'origine du site : l'adresse affichée (pseudo, numéro),
    // que la mesure n'envoie jamais, n'y part pas. Pas `no-referrer` : il ferait
    // partir `Origin: null`, refusé par la garde de provenance pour les
    // navigateurs sans `Sec-Fetch-Site` (Safari < 16.4, Firefox < 90).
    referrerPolicy: "strict-origin",
  }).catch(() => {
    // Mesure d'agrément : jamais de bruit dans la console du visiteur.
  });
}

/**
 * Statistiques de fréquentation détaillées (`docs/features/AUDIENCE_MEASUREMENT.md`,
 * registre T19) : signale les pages vues et le temps passé onglet visible.
 *
 * Monté dans le layout racine. Aucun cookie, aucun stockage, aucun identifiant
 * fabriqué ici ; rien ne part en cas d'opposition (GPC, DNT, bouton de
 * `/rgpd#audience`), que le serveur relit de son côté. Les envois sont groupés
 * (dix pages, une minute d'onglet visible, ou l'onglet qui passe en arrière-plan). Le cookie
 * d'opposition accompagne l'envoi pour que le serveur le relise ; la session,
 * elle, n'est jamais lue : la mesure ignore si le visiteur est connecté.
 */
export function AudienceBeacon() {
  const pathname = usePathname();
  const tracker = useRef<AudienceTracker | null>(null);
  /** Installation immédiate, tant que le repos n'est pas venu (sinon `null`). */
  const installNow = useRef<(() => void) | null>(null);
  /** Page d'arrivée, lue au montage : comptée même si le visiteur la quitte avant le repos. */
  const landing = useRef<string | null>(null);

  useEffect(() => {
    if (browserAudienceOptOut()) return;
    let teardown: (() => void) | null = null;
    landing.current = window.location.pathname;
    // Installé au repos du navigateur (comme `visit-tracker`) : le premier rendu
    // et l'hydratation ne se disputent pas le fil avec la mesure.
    const install = () => {
      if (tracker.current) return;
      installNow.current = null;
      window.removeEventListener("pagehide", onEarlyPageHide);
      cancelIdle();
      const instance = new AudienceTracker({
        // Horloge murale : le tracker y lit le jour de Paris (reprise un autre jour)
        // et une veille de la machine (performance.now() s'y arrête parfois).
        now: () => Date.now(),
        isVisible: () => document.visibilityState === "visible",
        device: () => deviceFromWidth(window.innerWidth),
        referrerHost: externalReferrerHost,
        send,
      });
      tracker.current = instance;
      // La page d'arrivée d'abord (avec son référent extérieur), puis celle
      // affichée maintenant si le visiteur a déjà navigué.
      instance.navigate(landing.current ?? window.location.pathname);
      instance.navigate(window.location.pathname);

      const onVisibility = () => {
        if (document.visibilityState === "hidden") instance.hidden();
        else instance.visible();
      };
      const onPageHide = () => instance.leave();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);

      // Le battement d'une minute suit le régime de charge (`CLIENT_POWER_MODES.md`) :
      // éteint onglet masqué (la lecture est close alors) et en économie, il se
      // rallume au retour. Abonnement sans rendu : aucun re-rendu du site.
      let timer: number | null = null;
      const syncTimer = () => {
        const run = powerPolicy(getClientPowerInput()).clocks;
        if (run && timer === null) {
          timer = window.setInterval(() => instance.tick(), AUDIENCE_CLIENT_FLUSH_MS);
        } else if (!run && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      };
      syncTimer();
      const unsubscribe = subscribeClientPower(syncTimer);

      teardown = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onPageHide);
        unsubscribe();
        if (timer !== null) window.clearInterval(timer);
        instance.leave();
        tracker.current = null;
      };
    };
    // `requestIdleCallback` manque sur Safari historique : le repli en
    // `setTimeout` laisse passer le premier rendu. Le délai borne l'attente.
    const supportsIdle = typeof window.requestIdleCallback === "function";
    const handle = supportsIdle ? window.requestIdleCallback(install, { timeout: 1000 }) : window.setTimeout(install, 300);
    function cancelIdle() {
      if (supportsIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    }
    // Départ avant le repos : la page d'arrivée part quand même (rebond rapide).
    function onEarlyPageHide() {
      install();
      tracker.current?.leave();
    }
    window.addEventListener("pagehide", onEarlyPageHide);
    // Navigation avant le repos : installé sur-le-champ (voir l'effet suivant).
    installNow.current = install;

    return () => {
      installNow.current = null;
      window.removeEventListener("pagehide", onEarlyPageHide);
      cancelIdle();
      teardown?.();
    };
  }, []);

  useEffect(() => {
    // Première navigation interne avant le repos : la page d'arrivée n'est pas
    // perdue ni confondue avec celle-ci (`install` les compte dans l'ordre).
    if (!tracker.current && installNow.current && window.location.pathname !== landing.current) {
      installNow.current();
      return;
    }
    tracker.current?.navigate(window.location.pathname);
  }, [pathname]);

  return null;
}
