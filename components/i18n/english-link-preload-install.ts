"use client";

import { preloadEnglishRoute } from "./english-route-preload";
import { setRoutePreload } from "./route-preload";

/**
 * Pose l'écouteur délégué du préchargement (survol, focus d'un lien `/en/…`)
 * et inscrit le préchargement des navigations par le code ; rend de quoi les
 * retirer. Chargé à la demande par `EnglishLinkPreload` (sous `/en`
 * seulement) : rien de ceci n'est dans le premier chargement d'une page.
 */
/**
 * Le lien ouvre-t-il sa page dans cet onglet ? `target` absent, vide ou
 * `_self` (mots-clés insensibles à la casse) ; `_top` et `_parent` aussi
 * depuis la fenêtre principale.
 */
function opensHere(link: HTMLAnchorElement): boolean {
  const target = (link.getAttribute("target") ?? "").trim().toLowerCase();
  if (target === "" || target === "_self") return true;
  return (target === "_top" || target === "_parent") && window.top === window;
}

export function installEnglishLinkPreload(): () => void {
  // `pointerover` part de chaque enfant traversé : un même lien ne compte qu'une
  // fois par seconde (un nouvel essai reste possible ensuite).
  let last = "";
  let lastAt = 0;
  const onIntent = (event: Event) => {
    // Au toucher, `pointerover` part aussi au début d'un défilement : seul un vrai survol (souris, stylet) annonce l'intention.
    if (event.type === "pointerover" && (event as PointerEvent).pointerType === "touch") return;
    const found = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(found instanceof HTMLAnchorElement)) return;
    const link = found;
    // Un clic qui n'ouvre pas la page **ici** (nouvel onglet, téléchargement) n'a rien à précharger.
    if (event.type === "click") {
      const click = event as MouseEvent;
      if (click.button !== 0 || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return;
      if (link.hasAttribute("download") || !opensHere(link)) return;
    }
    // L'adresse résolue : liens absolus du site et relatifs compris.
    if (link.origin !== window.location.origin) return;
    const href = link.pathname;
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
