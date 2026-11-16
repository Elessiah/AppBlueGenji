/**
 * La session change **sans recharger le document** (déconnexion, connexion
 * suivies d'une navigation client et de `router.refresh()`) : ce qui était
 * retenu pour le compte précédent — un refus de « Ne plus voir » en attente
 * d'être dit (`noticeOnceModalsClosed`) — ne doit pas s'adresser au suivant.
 *
 * État du module client : il survit à la navigation client, comme ce qu'il
 * doit abandonner.
 */

const listeners = new Set<() => void>();

/** Appelle `listener` au prochain changement de session ; renvoie l'arrêt. */
export function onSessionChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** La session vient de changer : à appeler après une déconnexion ou une connexion réussie. */
export function signalSessionChanged(): void {
  for (const listener of [...listeners]) listener();
}
