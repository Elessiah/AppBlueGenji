"use client";

import { useEffect } from "react";

type Targets = typeof import("./english-link-targets");

/**
 * Sous `/en`, l'anglais d'une page de l'espace connecté part **au survol ou au
 * focus** de tout lien qui y mène (barre de navigation, noms d'équipe et de
 * joueur, menu du compte…) — revue de performance du lot 9-2 : les mises en
 * page ne le sérialisent qu'au chargement complet, et une page atteinte par
 * navigation n'attend plus son morceau après la réponse du routeur. Un seul
 * écouteur délégué, posé par la mise en page de l'espace connecté sous `/en`
 * seulement ; la table des cibles (`english-link-targets.ts`) arrive au
 * premier survol.
 */
export function EnglishLinkPreload() {
  useEffect(() => {
    let targets: Promise<Targets> | null = null;
    const onIntent = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href") ?? "";
      if (!href.startsWith("/en/")) return;
      targets ??= import("./english-link-targets");
      targets.then(
        (module) => module.preloadEnglishFor(href.slice(3)),
        () => {
          targets = null;
        },
      );
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
