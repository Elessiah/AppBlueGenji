"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { browserAudienceOptOut } from "@/components/visit-tracker";
import { AUDIENCE_CLIENT_FLUSH_MS, deviceFromWidth, type AudienceBeaconEntry } from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";

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
 * (dix pages, une minute, ou l'onglet qui passe en arrière-plan). Le cookie
 * d'opposition accompagne l'envoi pour que le serveur le relise ; la session,
 * elle, n'est jamais lue : la mesure ignore si le visiteur est connecté.
 */
export function AudienceBeacon() {
  const pathname = usePathname();
  const tracker = useRef<AudienceTracker | null>(null);

  useEffect(() => {
    if (browserAudienceOptOut()) return;
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
    instance.navigate(window.location.pathname);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") instance.hidden();
      else instance.visible();
    };
    const onPageHide = () => instance.leave();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const timer = window.setInterval(() => instance.tick(), AUDIENCE_CLIENT_FLUSH_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(timer);
      instance.leave();
      tracker.current = null;
    };
  }, []);

  useEffect(() => {
    tracker.current?.navigate(window.location.pathname);
  }, [pathname]);

  return null;
}
