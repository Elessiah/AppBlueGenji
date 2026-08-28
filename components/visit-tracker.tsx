"use client";

import { useEffect } from "react";
import { SITE_VISIT_WINDOW_MINUTES } from "@/lib/shared/site-visits";

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
 *
 * Il est aussi **dédupliqué dans l'onglet** sur la même fenêtre que le serveur.
 * Le comptage ne change pas — le serveur regroupait déjà ces chargements — mais
 * un visiteur qui recharge en boucle ne fait plus payer à chaque fois une
 * résolution de session et une lecture en base. C'est un confort de serveur, pas
 * une mesure d'exactitude : un onglet neuf, ou un stockage indisponible,
 * renvoient simplement l'appel.
 */
const VISIT_SENT_KEY = "bg:last-visit-ping";

/** Un ping a-t-il déjà été envoyé dans cet onglet, sur la fenêtre en cours ? */
function pingedRecently(): boolean {
  try {
    const raw = window.sessionStorage.getItem(VISIT_SENT_KEY);
    if (!raw) return false;
    const sentAt = Number(raw);
    if (!Number.isFinite(sentAt)) return false;
    return Date.now() - sentAt < SITE_VISIT_WINDOW_MINUTES * 60_000;
  } catch {
    // Navigation privée, stockage bloqué : on envoie, comme avant.
    return false;
  }
}

function rememberPing(): void {
  try {
    window.sessionStorage.setItem(VISIT_SENT_KEY, String(Date.now()));
  } catch {
    // Sans stockage, la déduplication est simplement inactive.
  }
}
export function VisitTracker() {
  useEffect(() => {
    const controller = new AbortController();

    const send = () => {
      if (pingedRecently()) return;

      fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: window.location.pathname }),
        keepalive: true,
        signal: controller.signal,
      })
        // Marqué seulement une fois l'envoi abouti : poser la marque avant
        // ferait perdre la visite pour toute la fenêtre si la requête échoue
        // (réseau coupé, serveur en redémarrage) alors que rien n'a été
        // enregistré côté serveur.
        .then(() => rememberPing())
        .catch(() => {
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
