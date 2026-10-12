"use client";

import { PRELOAD_RETRY_MS } from "@/lib/shared/lazy-component";

/*
 * Module minuscule, importé par `useLocaleRouter` sur chaque page : la table
 * des cibles, elle, n'arrive qu'au premier appel, sous `/en`.
 */
type Targets = typeof import("./english-link-targets");

let targets: Promise<Targets> | null = null;
let failedAt: number | null = null;

/**
 * Lance l'anglais de la page `path` (chemin sans préfixe, `/equipes/5`) : la
 * table des cibles (`english-link-targets.ts`) arrive au premier appel. Un
 * échec de ce morceau (déploiement, hors ligne) se tait `PRELOAD_RETRY_MS`
 * au lieu de repartir à chaque survol.
 */
export function preloadEnglishRoute(path: string): void {
  if (failedAt !== null && Date.now() - failedAt < PRELOAD_RETRY_MS) return;
  targets ??= import("./english-link-targets");
  targets.then(
    (module) => {
      failedAt = null;
      module.preloadEnglishFor(path);
    },
    () => {
      targets = null;
      failedAt = Date.now();
    },
  );
}
