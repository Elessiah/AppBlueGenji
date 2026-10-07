"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toast";
import type { Locale } from "@/lib/shared/locales";
import {
  FR_TOURNAMENT_PAGE_TEXT,
  frenchBlockLang,
  tournamentPageText,
  type TournamentPageMessages,
  type TournamentPageText,
} from "@/lib/shared/tournament-page-text";

/**
 * Textes de la fiche d'un tournoi (`lib/shared/tournament-page-text.ts`). Hors
 * fournisseur (tests, composant rendu ailleurs) : le français du paquet.
 */
const TournamentPageTextContext = createContext<TournamentPageText>(FR_TOURNAMENT_PAGE_TEXT);

export function TournamentPageTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentPageMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une fiche française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  // Indexé sur la **langue** seule, comme `LoginTextProvider` : chaque rendu
  // serveur (`router.refresh()`) renvoie un nouvel objet `messages`, au contenu
  // identique — un nouveau `text` rouvrirait le flux (`useTournamentLive`) et
  // redessinerait tout le plateau.
  const build = () => (messages ? tournamentPageText(locale, messages) : FR_TOURNAMENT_PAGE_TEXT);
  const [value, setValue] = useState(build);
  if (value.locale !== locale) setValue(build());
  return <TournamentPageTextContext.Provider value={value}>{children}</TournamentPageTextContext.Provider>;
}

export function useTournamentPageText(): TournamentPageText {
  return useContext(TournamentPageTextContext);
}

/**
 * Texte d'une vue chargée à la demande (suisse, survie, endurance) : en
 * français, celui que la vue apporte dans son propre morceau (`frView`, construit
 * par `frTournamentViewText` dans `_lib/views-text.ts`) ; sous `/en`, celui du
 * fournisseur, qui porte déjà tous les espaces.
 */
export function useTournamentViewText(frView: TournamentPageText): TournamentPageText {
  const text = useTournamentPageText();
  return text.locale === "fr" ? frView : text;
}

/**
 * Notifications d'un bloc resté en français (gestes du lot 8b, outils du staff) :
 * sous `/en`, le message porte `lang="fr"` ; en français, rien ne change.
 */
export function useFrenchBlockToast(): Pick<ReturnType<typeof useToast>, "showError" | "showSuccess"> {
  const toast = useToast();
  const lang = frenchBlockLang(useTournamentPageText());
  return useMemo(() => {
    if (!lang) return { showError: toast.showError, showSuccess: toast.showSuccess };
    return {
      showError: (message: string) => toast.showError(message, { lang }),
      showSuccess: (message: string) => toast.showSuccess(message, { lang }),
    };
  }, [toast, lang]);
}
