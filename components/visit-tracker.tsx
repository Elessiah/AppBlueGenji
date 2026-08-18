"use client";

import { useEffect } from "react";

/**
 * Signale une visite du site au serveur, une fois par chargement de page.
 *
 * Monté dans le layout racine, donc présent sur toutes les pages, publiques
 * comme protégées. Les navigations internes (App Router) ne remontent pas le
 * composant : ce qui est mesuré est bien une **arrivée sur le site**, pas une
 * page vue. Le regroupement fin (fenêtre de session) et l'identité du visiteur
 * sont décidés côté serveur — ici, aucun identifiant n'est fabriqué ni stocké.
 *
 * L'appel est en meilleur effort : différé au premier temps mort pour ne pas
 * disputer la bande passante aux requêtes de la page, `keepalive` pour survivre
 * à une navigation immédiate, et toute erreur ignorée pour ne rien casser à
 * l'affichage.
 */
export function VisitTracker() {
  useEffect(() => {
    const controller = new AbortController();

    const send = () => {
      fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: window.location.pathname }),
        keepalive: true,
        signal: controller.signal,
      }).catch(() => {
        // Fréquentation = agrément : jamais de bruit dans la console du visiteur.
      });
    };

    // `requestIdleCallback` n'existe pas partout (Safari historique) : le repli
    // en `setTimeout` laisse simplement passer le premier rendu.
    const supportsIdle = typeof window.requestIdleCallback === "function";
    const handle = supportsIdle
      ? window.requestIdleCallback(send, { timeout: 2000 })
      : window.setTimeout(send, 500);

    return () => {
      controller.abort();
      if (supportsIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  return null;
}
