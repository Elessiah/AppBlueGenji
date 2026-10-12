"use client";

import { useEffect } from "react";
import { preloadEnglishRoute } from "./english-route-preload";
import { setRoutePreload } from "./route-preload";

/**
 * Sous `/en`, l'anglais d'une page de l'espace connecté part **au survol ou au
 * focus** de tout lien qui y mène (barre de navigation, noms d'équipe et de
 * joueur, menu du compte…) et **à toute navigation par le code**
 * (`useLocaleRouter`, par `route-preload.ts`) — revue de performance du lot
 * 9-2 : les mises en page ne le sérialisent qu'au chargement complet, et une
 * page atteinte par navigation n'attend plus son morceau après la réponse du
 * routeur. Un seul écouteur délégué, posé par la mise en page de l'espace
 * connecté sous `/en` seulement.
 */
export function EnglishLinkPreload() {
  useEffect(() => {
    // `pointerover` part de chaque enfant traversé : un même lien ne compte qu'une
    // fois par seconde (un nouvel essai reste possible ensuite).
    let last = "";
    let lastAt = 0;
    const onIntent = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href") ?? "";
      if (!href.startsWith("/en/")) return;
      const now = Date.now();
      if (href === last && now - lastAt < 1000) return;
      last = href;
      lastAt = now;
      preloadEnglishRoute(href.slice(3));
    };
    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("focusin", onIntent);
    setRoutePreload(preloadEnglishRoute);
    return () => {
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
      setRoutePreload(null);
    };
  }, []);
  return null;
}
