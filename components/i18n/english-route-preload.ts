"use client";

import { onceLoader, quietPreload } from "@/lib/shared/lazy-component";
import { ENGLISH_PAGES, englishPageOf, type EnglishPage } from "./english-pages";

const targets = onceLoader(() => import("./english-link-targets"));
/**
 * Un préchargement par page : la requête de la table est partagée tant
 * qu'elle est en vol (`onceLoader`), chaque page garde son propre silence
 * après un échec (`quietPreload`) — rien de retenu d'un essai à l'autre.
 */
const WARM = Object.fromEntries(
  (Object.keys(ENGLISH_PAGES) as EnglishPage[]).map((page) => [
    page,
    quietPreload(() => targets.load().then((module) => module.preloadEnglishPage(page))),
  ]),
) as Record<EnglishPage, () => boolean>;

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
  if (loaded) loaded.preloadEnglishPage(page);
  else WARM[page]();
}
