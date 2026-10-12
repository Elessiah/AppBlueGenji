"use client";

import frProfile from "@/messages/fr/profile.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { createScopedTextContext } from "./scoped-text-context";

/**
 * Textes de `/profil` (espace `profile`, lot 9-2) : français du paquet,
 * anglais sérialisé par `app/(secured)/profil/layout.tsx` sous `/en`
 * seulement.
 */
export type ProfileMessages = typeof frProfile;
export type ProfileText = ScopedText<Leaves<ProfileMessages>>;

const context = createScopedTextContext<ProfileMessages>(frProfile);

export const ProfileTextProvider = context.Provider;
export const FR_PROFILE_TEXT: ProfileText = context.fr;

export function useProfileText(): ProfileText {
  return context.useText();
}
