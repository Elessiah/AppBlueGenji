"use client";

import type { ProfileMessages } from "./profile-text";
import { primeEnglish } from "./english-loaders";
import { englishProfile } from "./english-loader-profile";
import { createScopedTextSlot, type ScopedTextProvider } from "./scoped-text-context";

/**
 * Le fournisseur des textes de `/profil`, **sans** leur français : posé par
 * `app/(secured)/profil/layout.tsx`, il n'embarque pas
 * `messages/fr/profile.json` dans le morceau de la mise en page — la page l'a
 * déjà (`profile-text.tsx`).
 */
export const profileTextSlot = createScopedTextSlot<ProfileMessages>();

/** L'anglais reçu amorce le chargeur partagé (`englishProfile`) : une navigation suivante ne le recharge pas. */
export const ProfileTextProvider: ScopedTextProvider<ProfileMessages> = (props) => {
  primeEnglish(englishProfile, props.locale, props.messages);
  return <profileTextSlot.Provider {...props} />;
};
