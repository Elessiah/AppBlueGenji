"use client";

import { useEffect, useState } from "react";
import { PRELOAD_RETRY_MS, type OnceLoader } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import { inBrowser } from "./english-loaders";

/** Les chargements qu'un échec a mis en reprise de fond (un seul cycle par chargeur) — ici, module de l'espace connecté, pas dans `lazy-component.ts` servi à chaque page. */
const retrying = new WeakSet<object>();

/**
 * Après l'échec d'un chargement, le reprend **en fond** toutes les
 * `PRELOAD_RETRY_MS`, onglet visible seulement, jusqu'à réussite — un seul
 * cycle par chargeur, quel que soit le nombre d'écrans qui l'attendent. Rien
 * n'est rendu à nouveau : l'écran resté en français le reste (une bascule en
 * cours de saisie la perdrait) ; c'est la navigation suivante qui trouve le
 * résultat (`loaded()`).
 */
export function retryInBackground(loader: Pick<OnceLoader<unknown>, "load" | "loaded">): void {
  if (typeof window === "undefined" || retrying.has(loader)) return;
  retrying.add(loader);
  const attempt = () => {
    if (loader.loaded() !== null) {
      retrying.delete(loader);
      return;
    }
    if (document.visibilityState !== "visible") {
      window.setTimeout(attempt, PRELOAD_RETRY_MS);
      return;
    }
    loader.load().then(
      () => retrying.delete(loader),
      () => window.setTimeout(attempt, PRELOAD_RETRY_MS),
    );
  };
  window.setTimeout(attempt, PRELOAD_RETRY_MS);
}


/**
 * L'anglais d'une page sous `/en` : celui qu'a sérialisé la mise en page
 * (`provided`), sinon celui déjà reçu dans la session, sinon chargé à part
 * (cas de secours : la mise en page le sert à toute requête qui ne vient pas
 * d'une page qui le tient déjà). `null` tant qu'il manque ; `failed` : la page
 * retombe sur le français. Sur le serveur : `provided` seul. L'amorce des
 * chargeurs avec `provided` est faite par les fournisseurs (une seule place).
 */
export function useEnglishMessages<T>(
  locale: Locale,
  loader: Pick<OnceLoader<T>, "load" | "loaded">,
  provided: T | undefined,
): { english: T | null; failed: boolean } {
  const [english, setEnglish] = useState<T | null>(() => {
    if (locale !== "en") return null;
    return provided ?? (inBrowser() ? loader.loaded() : null);
  });
  const [failed, setFailed] = useState(false);
  const waiting = locale === "en" && !english && !failed;

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    loader.load().then(
      (loaded) => {
        if (live) setEnglish(loaded);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [waiting, loader]);

  // Un échec n'est pas définitif, sans rien démonter : l'écran reste en français,
  // le chargement reprend en fond (onglet visible, un cycle par chargeur) et la
  // navigation suivante trouve l'anglais.
  useEffect(() => {
    if (failed) retryInBackground(loader);
  }, [failed, loader]);

  return { english: locale === "en" ? english : null, failed };
}
