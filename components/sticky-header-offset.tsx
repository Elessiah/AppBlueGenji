"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  STICKY_HEADER_ATTR,
  STICKY_HEADER_HEIGHT_VAR,
  stickyHeaderHeightValue,
} from "@/lib/shared/sticky-header";

/**
 * Mesure l'en-tête collant de la page (`[data-sticky-header]`) et pose sa
 * hauteur sur `<html>` (`--sticky-header-h`), que lit `scroll-padding-top` :
 * une ancre ou un focus ramené en haut de la vue s'arrête **sous** l'en-tête,
 * quelle que soit sa hauteur du moment (`lib/shared/sticky-header.ts`).
 *
 * Monté dans la mise en page racine ; l'en-tête change d'une page à l'autre
 * (vitrine ↔ espace connecté), d'où une nouvelle recherche à chaque chemin.
 * Sans en-tête, la propriété vaut `0px`. Ne rend rien.
 */
export function StickyHeaderOffset() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>(`[${STICKY_HEADER_ATTR}]`);
    const apply = () => {
      root.style.setProperty(
        STICKY_HEADER_HEIGHT_VAR,
        stickyHeaderHeightValue(header ? header.getBoundingClientRect().height : null),
      );
    };
    apply();
    if (!header || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
