"use client";

import { onceLoader, quietPreload } from "@/lib/shared/lazy-component";

/**
 * Lance l'anglais de la page `path` (sans préfixe, `/equipes/5`) — survol d'un
 * lien ou navigation par le code sous `/en` (`EnglishLinkPreload`). Une page
 * sans anglais à précharger ne télécharge rien ; sinon la table des cibles
 * (`english-link-targets.ts`) arrive au premier appel, un échec se taisant
 * `PRELOAD_RETRY_MS` (`quietPreload`).
 */
const TARGET_PAGES = /^\/(profil|equipes(\/creer|\/\d+)?|joueurs(\/\d+)?|signalements\/\d+)$/;

/** Le chemin sans requête, ancre ni barre finale. */
export function barePath(path: string): string {
  const bare = path.split(/[?#]/)[0];
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

const targets = onceLoader(() => import("./english-link-targets"));
let wanted = "";
const warmTargets = quietPreload(() => targets.load().then((module) => module.preloadEnglishFor(wanted)));

export function preloadEnglishRoute(path: string): void {
  const bare = barePath(path);
  if (!TARGET_PAGES.test(bare)) return;
  const loaded = targets.loaded();
  if (loaded) {
    loaded.preloadEnglishFor(bare);
    return;
  }
  wanted = bare;
  warmTargets();
}
