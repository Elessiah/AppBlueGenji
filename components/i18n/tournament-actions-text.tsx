"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import {
  tournamentActionsText,
  tournamentErrorsText,
  tournamentFormText,
  tournamentImageText,
  type TournamentActionsClientMessages,
  type TournamentActionsText,
  type TournamentErrorsText,
  type TournamentFormText,
  type TournamentImageText,
} from "@/lib/shared/tournament-actions-text";

/**
 * Textes des gestes d'un tournoi (lot 8b, `lib/shared/tournament-actions-text.ts`).
 *
 * Le fournisseur ne porte que l'**anglais** : en français, chaque espace est
 * lu dans le paquet par son propre module (`_lib/error-map.ts`,
 * `_lib/actions-text.ts`, `_lib/dialogs-text.ts`, `_lib/image-text.ts`,
 * `_lib/form-text.ts`), qui passe son français en repli aux crochets
 * ci-dessous. Hors fournisseur (tests, page française) : ce repli.
 *
 * Les fenêtres d'action (`tournamentDialogs`) ne passent **pas** par ici : leurs
 * deux langues voyagent avec leurs morceaux chargés à la demande, et le
 * fournisseur ne leur donne que la langue (`useTournamentActionsLocale`) — sans
 * quoi tout lecteur de `/en` recevrait leur anglais à chaque chargement.
 */
type ActionsTextValue = {
  readonly locale?: Locale;
  readonly errors?: TournamentErrorsText;
  readonly actions?: TournamentActionsText;
  readonly image?: TournamentImageText;
  readonly form?: TournamentFormText;
};

const TournamentActionsTextContext = createContext<ActionsTextValue>({});

function buildValue(locale: Locale, messages: TournamentActionsClientMessages | undefined): ActionsTextValue {
  if (!messages) return { locale };
  return {
    locale,
    errors: tournamentErrorsText(locale, messages.errors),
    actions: messages.actions ? tournamentActionsText(locale, messages.actions) : undefined,
    image: messages.image ? tournamentImageText(locale, messages.image) : undefined,
    form: messages.form ? tournamentFormText(locale, messages.form) : undefined,
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

/** Langue de la fiche ; `undefined` hors fournisseur (tests) — le français. */
export function useTournamentActionsLocale(): Locale | undefined {
  return useContext(TournamentActionsTextContext).locale;
}

/** Textes du sélecteur d'image ; `fr` : ceux du paquet. */
export function useTournamentImageTextFrom(fr: TournamentImageText): TournamentImageText {
  return useContext(TournamentActionsTextContext).image ?? fr;
}

/** Textes des formulaires de création et d'édition ; `fr` : ceux du paquet. */
export function useTournamentFormTextFrom(fr: TournamentFormText): TournamentFormText {
  return useContext(TournamentActionsTextContext).form ?? fr;
}
