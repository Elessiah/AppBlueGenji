"use client";

import { useEffect } from "react";
import { preloadEnglishRoute } from "./english-route-preload";

/**
 * Sous `/en`, l'anglais d'une page de l'espace connecté part **au survol ou au
 * focus** de tout lien qui y mène (barre de navigation, noms d'équipe et de
 * joueur, menu du compte…) — revue de performance du lot 9-2 : les mises en
 * page ne le sérialisent qu'au chargement complet, et une page atteinte par
 * navigation n'attend plus son morceau après la réponse du routeur. Un seul
 * écouteur délégué, posé par la mise en page de l'espace connecté sous `/en`
 * seulement. Les navigations par le code passent par `useLocaleRouter`, qui
 * appelle `preloadEnglishRoute` lui-même.
 */
export function EnglishLinkPreload() {
  useEffect(() => {
    let last = "";
    const onIntent = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href") ?? "";
      // `pointerover` part de chaque enfant traversé : un lien ne compte qu'une fois de suite.
      if (!href.startsWith("/en/") || href === last) return;
      last = href;
      preloadEnglishRoute(href.slice(3));
    };
    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("focusin", onIntent);
    return () => {
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
    };
  }, []);
  return null;
}
