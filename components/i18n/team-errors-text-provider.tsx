"use client";

import type { TeamErrorsMessages } from "@/app/(secured)/equipes/_lib/team-errors";
import { createScopedTextSlot } from "./scoped-text-context";

/**
 * Le fournisseur de la table des refus d'équipe, **sans** son français : posé
 * par `app/(secured)/equipes/layout.tsx`, il n'embarque ni
 * `messages/fr/teamErrors.json` ni le registre dans le morceau de la mise en
 * page — les pages les ont déjà (`team-errors-text.tsx`).
 */
export const teamErrorsTextSlot = createScopedTextSlot<TeamErrorsMessages>();

export const TeamErrorsTextProvider = teamErrorsTextSlot.Provider;
