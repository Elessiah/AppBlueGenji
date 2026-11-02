"use client";

import { createContext } from "react";
import type { MatchLaunchInfo } from "@/lib/shared/match-launch";
import type { MatchContactsState } from "./MatchContactsDialog";

/** Une lecture des contacts d'un match déjà tenue par la page qui porte la modale. */
export type SharedMatchContacts = { matchId: number; state: MatchContactsState; launch: MatchLaunchInfo | null };

/**
 * Lecture des contacts que la page du match tient déjà (`useMatchContacts`) :
 * la modale « Contacts » ouverte depuis cette page la reprend au lieu de relire
 * la même route (quota de 30 lectures par minute) avec ses propres relectures.
 * `null` hors de la page du match, ou quand la page ne lit rien.
 */
export const SharedMatchContactsContext = createContext<SharedMatchContacts | null>(null);
