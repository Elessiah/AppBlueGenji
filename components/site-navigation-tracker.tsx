"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordSitePathname } from "@/lib/shared/site-back";

/**
 * Relève chaque changement de chemin, pour qu'un bouton « Retour » sache si la
 * page précédente est encore sur le site (`lib/shared/site-back.ts`). Monté dans
 * la mise en page racine : une navigation interne ne remonte pas ce composant,
 * c'est justement ce qui la distingue d'une arrivée. Ne rend rien.
 */
export function SiteNavigationTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordSitePathname(pathname);
  }, [pathname]);
  return null;
}
