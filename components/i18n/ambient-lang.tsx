"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Langue **ambiante** d'un sous-arbre qui déclare un `lang` différent de la
 * page — une modale de personnel `lang="fr"` ouverte sous `/en`.
 *
 * Le DOM porte déjà ce `lang` ; ce contexte le donne aussi au **premier rendu**
 * (et au rendu serveur), avant tout montage : un composant qui en dépend (le
 * nom du bouton « i », `InfoHint`) se rend d'emblée dans la bonne langue au
 * lieu de passer un instant par celle de la page. Hors de tout fournisseur :
 * `undefined` (la langue de la page s'applique).
 */
const AmbientLangContext = createContext<string | undefined>(undefined);

/** La langue ambiante déclarée par le plus proche fournisseur, s'il y en a un. */
export function useAmbientLang(): string | undefined {
  return useContext(AmbientLangContext);
}

/**
 * Pose la langue ambiante du sous-arbre. À placer **avec** le `lang` du DOM
 * qu'il double ; `lang` absent : le fournisseur parent (ou la page) s'applique.
 */
export function AmbientLang({ lang, children }: Readonly<{ lang: string | undefined; children: ReactNode }>) {
  const parent = useContext(AmbientLangContext);
  return <AmbientLangContext.Provider value={lang ?? parent}>{children}</AmbientLangContext.Provider>;
}
