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
export type ScopedTextContext<M extends object> = {
  /** Le français du paquet. */
  readonly fr: ScopedText<Leaves<M>>;
  readonly Provider: (props: Readonly<{ locale: Locale; messages?: M; children: ReactNode }>) => ReactNode;
  readonly useText: () => ScopedText<Leaves<M>>;
};

export function createScopedTextContext<M extends object>(frMessages: M): ScopedTextContext<M> {
  const fr = scopedText("fr", frMessages);
  const Context = createContext<ScopedText<Leaves<M>>>(fr);

  function Provider({ locale, messages, children }: Readonly<{ locale: Locale; messages?: M; children: ReactNode }>) {
    // Indexé sur la **langue** seule : chaque rendu serveur (`router.refresh()`)
    // renvoie un objet `messages` neuf au contenu identique, et un texte neuf
    // relancerait les effets qui le lisent.
    const [state, setState] = useState(() => ({ locale, value: messages ? scopedText(locale, messages) : fr }));
    if (state.locale !== locale) setState({ locale, value: messages ? scopedText(locale, messages) : fr });
    return <Context.Provider value={state.value}>{children}</Context.Provider>;
  }

  return { fr, Provider, useText: () => useContext(Context) };
}
