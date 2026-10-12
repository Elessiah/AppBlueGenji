"use client";

import { useEffect, useState } from "react";
import type { OnceLoader } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import { inBrowser } from "./english-loaders";

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

  return { english: locale === "en" ? english : null, failed };
}
