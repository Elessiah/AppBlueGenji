"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { OnceLoader } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import { inBrowser } from "./english-loaders";

/**
 * L'anglais d'une page sous `/en` : celui qu'a sérialisé la mise en page
 * (`provided`), sinon celui déjà reçu dans la session, sinon chargé à part.
 * `null` tant qu'il manque ; `failed` : l'écran retombe sur le français. Sur
 * le serveur : `provided` seul. L'amorce des chargeurs avec `provided` est
 * faite par les fournisseurs (une seule place).
 *
 * Un échec vaut **pour l'adresse affichée** : aucune boucle de reprise (un
 * morceau disparu après un déploiement ne reviendrait pas), mais la navigation
 * suivante — y compris sous une mise en page restée montée — retente
 * (`onceLoader` ne garde pas un échec), l'écran d'attente le temps de l'essai.
 * Rien n'est rechargé pour un écran déjà affiché en français : une bascule en
 * cours de saisie la perdrait.
 */
export function useEnglishMessages<T>(
  locale: Locale,
  loader: Pick<OnceLoader<T>, "load" | "loaded">,
  provided: T | undefined,
  /** `"remount"` : un échec vaut jusqu'au prochain montage (fenêtre rouverte), pas à la navigation suivante. */
  retry: "navigation" | "remount" = "navigation",
): { english: T | null; failed: boolean; waiting: boolean } {
  const [english, setEnglish] = useState<T | null>(() => {
    if (locale !== "en") return null;
    return provided ?? (inBrowser() ? loader.loaded() : null);
  });
  // L'adresse où le chargement a échoué : l'échec ne vaut que pour elle.
  const pathname = usePathname();
  const scope = retry === "remount" ? "" : pathname;
  const [failedAt, setFailedAt] = useState<string | null | undefined>(undefined);
  const failed = failedAt !== undefined && failedAt === scope;
  const waiting = locale === "en" && !english && !failed;

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    loader.load().then(
      (loaded) => {
        if (live) setEnglish(loaded);
      },
      () => {
        if (live) setFailedAt(scope);
      },
    );
    return () => {
      live = false;
    };
  }, [waiting, loader, scope]);

  // `waiting` : l'écran d'attente se montre — sous `/en`, ni anglais ni échec.
  return { english: locale === "en" ? english : null, failed, waiting };
}
