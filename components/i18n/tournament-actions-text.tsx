"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import {
  tournamentActionsText,
  tournamentDialogsText,
  tournamentErrorsText,
  type TournamentActionsClientMessages,
  type TournamentActionsText,
  type TournamentDialogsText,
  type TournamentErrorsText,
} from "@/lib/shared/tournament-actions-text";

/**
 * Textes des gestes d'un tournoi (lot 8b, `lib/shared/tournament-actions-text.ts`).
 *
 * Le fournisseur ne porte que l'**anglais** : en français, chaque espace est
 * lu dans le paquet par son propre module (`_lib/error-map.ts`,
 * `_lib/actions-text.ts`, `_lib/dialogs-text.ts`), qui passe son français en
 * repli aux crochets ci-dessous. Hors fournisseur (tests, page française) : ce
 * repli.
 */
type ActionsTextValue = {
  readonly errors?: TournamentErrorsText;
  readonly actions?: TournamentActionsText;
  readonly dialogs?: TournamentDialogsText;
};

const TournamentActionsTextContext = createContext<ActionsTextValue>({});

function buildValue(locale: Locale, messages: TournamentActionsClientMessages | undefined): ActionsTextValue {
  if (!messages) return {};
  return {
    errors: tournamentErrorsText(locale, messages.errors),
    actions: messages.actions ? tournamentActionsText(locale, messages.actions) : undefined,
    dialogs: messages.dialogs ? tournamentDialogsText(locale, messages.dialogs) : undefined,
  };
}

export function TournamentActionsTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentActionsClientMessages; children: ReactNode }>) {
  // Indexé sur la **langue** seule, comme `TournamentPageTextProvider` : chaque
  // rendu serveur (`router.refresh()`) renvoie un nouvel objet `messages` au
  // contenu identique, et un nouveau texte relancerait les effets qui le lisent.
  const [state, setState] = useState(() => ({ locale, value: buildValue(locale, messages) }));
  if (state.locale !== locale) setState({ locale, value: buildValue(locale, messages) });
  return <TournamentActionsTextContext.Provider value={state.value}>{children}</TournamentActionsTextContext.Provider>;
}

/** Table des refus de la page ; `fr` : celle du paquet. */
export function useTournamentErrorsText(fr: TournamentErrorsText): TournamentErrorsText {
  return useContext(TournamentActionsTextContext).errors ?? fr;
}

/** Textes des gestes rendus avec la fiche ; `fr` : ceux du paquet. */
export function useTournamentActionsTextFrom(fr: TournamentActionsText): TournamentActionsText {
  return useContext(TournamentActionsTextContext).actions ?? fr;
}

/** Textes des fenêtres d'action ; `fr` : ceux du morceau de la fenêtre. */
export function useTournamentDialogsTextFrom(fr: TournamentDialogsText): TournamentDialogsText {
  return useContext(TournamentActionsTextContext).dialogs ?? fr;
}
