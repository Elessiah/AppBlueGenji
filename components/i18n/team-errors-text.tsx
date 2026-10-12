"use client";

import { useCallback } from "react";
import frTeamErrors from "@/messages/fr/teamErrors.json";
import {
  membershipErrorMessage,
  teamErrorMessage,
  type TeamErrorsMessages,
  type TeamErrorsText,
} from "@/app/(secured)/equipes/_lib/team-errors";
import { withFrenchFallback } from "./scoped-text-context";
import { teamErrorsTextSlot } from "./team-errors-text-provider";

/**
 * Table des refus des écrans d'équipe (espace `teamErrors`, lot 9) : le
 * français du paquet, l'anglais posé par la mise en page `/equipes` sous `/en`
 * seulement (`/profil` la posera au lot 9-2) — par le fournisseur de
 * `team-errors-text-provider.tsx`, sans ce français (une mise en page qui
 * importerait ce module-ci l'enverrait une seconde fois).
 */
const context = withFrenchFallback<TeamErrorsMessages>(teamErrorsTextSlot, frTeamErrors);

/** Pour une **page** ; une mise en page importe `team-errors-text-provider.tsx`. */
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
