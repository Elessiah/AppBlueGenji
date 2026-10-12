"use client";

import frProfile from "@/messages/fr/profile.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { withFrenchFallback } from "./scoped-text-context";
import { profileTextSlot } from "./profile-text-provider";

/**
 * Textes de `/profil` (espace `profile`, lot 9-2) : français du paquet,
 * anglais sérialisé par `app/(secured)/profil/layout.tsx` sous `/en`
 * seulement — par le fournisseur de `profile-text-provider.tsx`, sans ce
 * français (une mise en page qui importerait ce module-ci l'enverrait une
 * seconde fois).
 */
export type ProfileMessages = typeof frProfile;
export type ProfileText = ScopedText<Leaves<ProfileMessages>>;

const context = withFrenchFallback(profileTextSlot, frProfile);

/** Pour une **page** ou un test : le fournisseur de `profile-text-provider.tsx` (il amorce le chargeur de l'anglais). */
export { ProfileTextProvider } from "./profile-text-provider";
export const FR_PROFILE_TEXT: ProfileText = context.fr;

export function useProfileText(): ProfileText {
  return context.useText();
}
