"use client";

import type frPush from "@/messages/fr/push.json";
import { englishPush, primeEnglish } from "@/components/i18n/english-loaders";
import { createScopedTextSlot, type ScopedTextProvider } from "@/components/i18n/scoped-text-context";

/**
 * Le fournisseur des textes `push`, **sans** leur français (revue de
 * performance du lot 9-2) : posé par `/profil` (`ProfileTextProviders`) et
 * par la fenêtre de lancement d'un match. Le français voyage avec le panneau
 * (`push-text.ts`) ; l'anglais reçu ici amorce le chargeur partagé
 * (`englishPush`) — la fenêtre de lancement ne le télécharge pas une seconde
 * fois.
 */
export const pushTextSlot = createScopedTextSlot<typeof frPush>();

export const PushTextProvider: ScopedTextProvider<typeof frPush> = (props) => {
  primeEnglish(englishPush, props.locale, props.messages);
  return <pushTextSlot.Provider {...props} />;
};
