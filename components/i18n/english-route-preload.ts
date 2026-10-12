"use client";

import { onceLoader, quietPreload } from "@/lib/shared/lazy-component";
import { englishPageOf, type EnglishPage } from "./english-pages";

const targets = onceLoader(() => import("./english-link-targets"));
/** Les pages demandées pendant que la table arrive : toutes servies à son arrivée. */
const wanted = new Set<EnglishPage>();
/** Un seul essai en vol : les survols pendant l'arrivée ne font qu'ajouter leur page. */
let warming = false;
const warmTargets = quietPreload(() => {
  warming = true;
  return targets.load().then(
    (module) => {
      warming = false;
      for (const page of wanted) module.preloadEnglishPage(page);
      wanted.clear();
    },
    (error: unknown) => {
      // Rien n'est gardé d'un essai raté : le prochain survol après le silence dit ce qu'il faut.
      warming = false;
      wanted.clear();
      throw error;
    },
  );
});

/**
 * Lance l'anglais de la page `path` (sans préfixe, `/equipes/5`) — survol d'un
 * lien ou navigation par le code sous `/en` (`EnglishLinkPreload`). Une page
 * hors de la table ne télécharge rien ; sinon la table des chargeurs arrive au
 * premier appel, un échec se taisant `PRELOAD_RETRY_MS` (`quietPreload`).
 */
export function preloadEnglishRoute(path: string): void {
  const page = englishPageOf(path);
  if (!page) return;
  const loaded = targets.loaded();
  if (loaded) {
    loaded.preloadEnglishPage(page);
    return;
  }
  if (warming) {
    wanted.add(page);
    return;
  }
  // Pendant le silence d'un échec, rien n'est retenu.
  if (warmTargets()) wanted.add(page);
}
