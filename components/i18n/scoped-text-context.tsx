"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Fournisseur d'un espace de messages pour des écrans **client**, sans
 * `next-intl` dans le navigateur (lot 9, `docs/features/I18N.md` § Équipes et
 * joueurs) — la mécanique des tournois (`TournamentsTextProvider`), écrite une
 * fois pour tous les espaces.
 *
 * Le français est celui du paquet (il remplace les chaînes écrites en dur) ;
 * l'anglais n'arrive que sous `/en`, sérialisé par la mise en page du segment.
 * Hors fournisseur (tests, page française) : le français.
 */
export type ScopedTextProvider<M extends object> = (
  props: Readonly<{ locale: Locale; messages?: M; children: ReactNode }>,
) => ReactNode;

/**
 * La moitié **sans** le français : le fournisseur et ce qu'il pose. Une mise
 * en page serveur qui pose un fournisseur n'importe que cette moitié (module
 * `*-text-provider.tsx`) : si son module importait aussi le JSON français,
 * celui-ci partirait **deux fois** au navigateur — dans le morceau de la mise
 * en page et dans celui de la page, que webpack ne met pas en commun sous son
 * seuil de taille.
 */
export type ScopedTextSlot<M extends object> = {
  readonly Provider: ScopedTextProvider<M>;
  /** Le texte posé par le fournisseur ; `undefined` : le français. */
  readonly useProvided: () => ScopedText<Leaves<M>> | undefined;
};

export type ScopedTextContext<M extends object> = {
  /** Le français du paquet. */
  readonly fr: ScopedText<Leaves<M>>;
  readonly Provider: ScopedTextProvider<M>;
  readonly useText: () => ScopedText<Leaves<M>>;
};

export function createScopedTextSlot<M extends object>(): ScopedTextSlot<M> {
  const Context = createContext<ScopedText<Leaves<M>> | undefined>(undefined);

  function Provider({ locale, messages, children }: Readonly<{ locale: Locale; messages?: M; children: ReactNode }>) {
    // Indexé sur la **langue** seule : chaque rendu serveur (`router.refresh()`)
    // renvoie un objet `messages` neuf au contenu identique, et un texte neuf
    // relancerait les effets qui le lisent.
    const read = () => ({ locale, value: messages ? scopedText(locale, messages) : undefined });
    const [state, setState] = useState(read);
    // Ou des messages arrivés après coup (réglage push monté avant son anglais) : une seule fois.
    if (state.locale !== locale || (state.value === undefined && messages !== undefined)) setState(read());
    return <Context.Provider value={state.value}>{children}</Context.Provider>;
  }

  return { Provider, useProvided: () => useContext(Context) };
}

/** Le texte d'un emplacement, le français du paquet à défaut. */
export function withFrenchFallback<M extends object>(slot: ScopedTextSlot<M>, frMessages: M): ScopedTextContext<M> {
  const fr = scopedText("fr", frMessages);
  return { fr, Provider: slot.Provider, useText: () => slot.useProvided() ?? fr };
}

/**
 * Emplacement et français dans un même module : pour un fournisseur posé par
 * la **page** elle-même (même morceau que ses lecteurs), ou dont le français
 * vit déjà dans un morceau commun.
 */
export function createScopedTextContext<M extends object>(frMessages: M): ScopedTextContext<M> {
  return withFrenchFallback(createScopedTextSlot<M>(), frMessages);
}
