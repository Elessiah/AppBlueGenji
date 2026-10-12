"use client";

import { preloadEnglishRoute } from "./english-route-preload";
import { setRoutePreload } from "./route-preload";

/**
 * Pose l'écouteur délégué du préchargement (survol, focus d'un lien `/en/…`)
 * et inscrit le préchargement des navigations par le code ; rend de quoi les
 * retirer. Chargé à la demande par `EnglishLinkPreload` (sous `/en`
 * seulement) : rien de ceci n'est dans le premier chargement d'une page.
 */
export function installEnglishLinkPreload(): () => void {
  // `pointerover` part de chaque enfant traversé : un même lien ne compte qu'une
  // fois par seconde (un nouvel essai reste possible ensuite).
  let last = "";
  let lastAt = 0;
  const onIntent = (event: Event) => {
    // Au toucher, `pointerover` part aussi au début d'un défilement : seul un vrai survol (souris, stylet) annonce l'intention.
    if (event.type === "pointerover" && (event as PointerEvent).pointerType === "touch") return;
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
  // Un tap (iOS ne donne pas le focus au lien touché) : le clic, en phase de
  // capture — avant la navigation du lien —, jamais un simple défilement.
  document.addEventListener("click", onIntent, { capture: true });
  setRoutePreload(preloadEnglishRoute);
  return () => {
    document.removeEventListener("pointerover", onIntent);
    document.removeEventListener("focusin", onIntent);
    document.removeEventListener("click", onIntent, { capture: true });
    setRoutePreload(null);
  };
}
