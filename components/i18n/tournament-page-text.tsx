"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { OnceLoader } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import {
  FR_TOURNAMENT_PAGE_TEXT,
  tournamentPageText,
  type TournamentSheetMessages,
  type TournamentPageText,
  type TournamentViewMessages,
} from "@/lib/shared/tournament-page-text";
import { suspendOn } from "./suspend-on-loader";

/**
 * Textes de la fiche d'un tournoi (`lib/shared/tournament-page-text.ts`). Hors
 * fournisseur (tests, composant rendu ailleurs) : le français du paquet.
 */
const TournamentPageTextContext = createContext<TournamentPageText>(FR_TOURNAMENT_PAGE_TEXT);
/** L'anglais de la fiche (sans les vues), que chaque vue complète du sien ; `null` en français. */
const TournamentSheetMessagesContext = createContext<TournamentSheetMessages | null>(null);

export function TournamentPageTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentSheetMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une fiche française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  // Indexé sur la **langue** seule, comme `LoginTextProvider` : un nouvel objet
  // `messages` au contenu identique ne doit pas donner un nouveau `text`, qui
  // rouvrirait le flux (`useTournamentLive`) et redessinerait tout le plateau.
  const build = () => ({ locale, messages: messages ?? null, text: messages ? tournamentPageText(locale, messages) : FR_TOURNAMENT_PAGE_TEXT });
  const [value, setValue] = useState(build);
  if (value.locale !== locale) setValue(build());
  return (
    <TournamentSheetMessagesContext.Provider value={value.messages}>
      <TournamentPageTextContext.Provider value={value.text}>{children}</TournamentPageTextContext.Provider>
    </TournamentSheetMessagesContext.Provider>
  );
}

export function useTournamentPageText(): TournamentPageText {
  return useContext(TournamentPageTextContext);
}

/** Un texte par (fiche, vue) : chaque composant d'une vue qui le lit reçoit le même objet. */
const viewTexts = new WeakMap<TournamentSheetMessages, WeakMap<TournamentViewMessages, TournamentPageText>>();

function englishViewText(sheet: TournamentSheetMessages, view: TournamentViewMessages): TournamentPageText {
  let byView = viewTexts.get(sheet);
  if (!byView) {
    byView = new WeakMap();
    viewTexts.set(sheet, byView);
  }
  let text = byView.get(view);
  if (!text) {
    text = tournamentPageText("en", sheet, view);
    byView.set(view, text);
  }
  return text;
}

/**
 * Texte d'une vue chargée à la demande (suisse, survie, endurance, graphique) :
 * en français, celui que la vue apporte dans son propre morceau (`frView`,
 * construit par `frTournamentViewText`) ; sous `/en`, l'anglais de la fiche
 * complété de celui de la vue (`english`, `_lib/view-loaders.ts`), qui ne voyage
 * qu'avec elle. Lancé avec le morceau de la vue (`withViewText`), il est
 * d'ordinaire déjà là ; sinon la vue suspend le temps de le charger.
 */
export function useTournamentViewText(
  frView: TournamentPageText,
  english: Pick<OnceLoader<TournamentViewMessages>, "load" | "loaded">,
): TournamentPageText {
  const text = useTournamentPageText();
  const sheet = useContext(TournamentSheetMessagesContext);
  if (text.locale === "fr") return frView;
  // Sans l'anglais de la fiche (hors fournisseur) : le texte du contexte.
  if (!sheet) return text;
  const view = english.loaded();
  return view ? englishViewText(sheet, view) : suspendOn(english);
}
