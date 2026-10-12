"use client";

import { useEffect } from "react";

/**
 * Sous `/en`, l'anglais d'une page de l'espace connecté part **au survol ou au
 * focus** de tout lien qui y mène — barre de navigation, en-tête public, noms
 * d'équipe et de joueur, menu du compte — et **à toute navigation par le
 * code** (`useLocaleRouter`, par `route-preload.ts`). Revue de performance du
 * lot 9-2 : les mises en page ne le sérialisent qu'au chargement complet, et
 * une page atteinte par navigation n'attend plus son morceau après la réponse
 * du routeur.
 *
 * Posé par la mise en page racine pour un compte connecté sous `/en` ; ce
 * composant ne fait que charger l'écouteur (`english-link-preload-install.ts`)
 * après l'hydratation — le premier chargement de la page n'en porte rien.
 */
export function EnglishLinkPreload() {
  useEffect(() => {
    let live = true;
    let uninstall: (() => void) | null = null;
    import("./english-link-preload-install").then(
      (module) => {
        if (live) uninstall = module.installEnglishLinkPreload();
      },
      () => undefined,
    );
    return () => {
      live = false;
      uninstall?.();
    };
  }, []);
  return null;
}
