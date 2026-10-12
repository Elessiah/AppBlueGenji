"use client";

import { useCallback } from "react";
import frTeamErrors from "@/messages/fr/teamErrors.json";
import {
  membershipErrorMessage,
  teamErrorMessage,
  type TeamErrorsMessages,
  type TeamErrorsText,
} from "@/app/(secured)/equipes/_lib/team-errors";
import { createScopedTextContext } from "./scoped-text-context";

/**
 * Table des refus des écrans d'équipe (espace `teamErrors`, lot 9) : le
 * français du paquet, l'anglais posé par les mises en page `/equipes` et
 * `/profil` sous `/en` seulement.
 */
const context = createScopedTextContext<TeamErrorsMessages>(frTeamErrors);

export const TeamErrorsTextProvider = context.Provider;

export function useTeamErrorsText(): TeamErrorsText {
  return context.useText();
}

/** `teamErrorMessage` dans la langue de la page. */
export function useTeamErrorMessage(): (code: string | null | undefined, fallbackCode?: string) => string {
  const text = useTeamErrorsText();
  return useCallback((code, fallbackCode) => teamErrorMessage(code, fallbackCode, text), [text]);
}

/** `membershipErrorMessage` dans la langue de la page. */
export function useMembershipErrorMessage(): (code: string | null | undefined, fallbackCode?: string) => string {
  const text = useTeamErrorsText();
  return useCallback((code, fallbackCode) => membershipErrorMessage(code, fallbackCode, text), [text]);
}
