"use client";

import type { ProfileMessages } from "./profile-text";
import { createScopedTextSlot } from "./scoped-text-context";

/**
 * Le fournisseur des textes de `/profil`, **sans** leur français : posé par
 * `app/(secured)/profil/layout.tsx`, il n'embarque pas
 * `messages/fr/profile.json` dans le morceau de la mise en page — la page l'a
 * déjà (`profile-text.tsx`).
 */
export const profileTextSlot = createScopedTextSlot<ProfileMessages>();

export const ProfileTextProvider = profileTextSlot.Provider;
