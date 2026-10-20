"use client";

import { useEffect, useRef } from "react";
import { useAccountDeletion } from "@/components/account/use-account-deletion";
import { englishProfile } from "@/components/i18n/english-loaders-account";
import { useAppLocale } from "@/components/i18n/locale-context";
import { ProfileTextProvider, useProfileText } from "@/components/i18n/profile-text";
import { useEnglishMessagesUntilRemount } from "@/components/i18n/use-english-messages";

interface TermsAccountDeletionProps {
  /** La confirmation est annulée : la fenêtre des conditions reprend la main. */
  onClose: () => void;
  /** La confirmation s'ouvre : le bouton de la fenêtre quitte son libellé d'attente. */
  onReady?: () => void;
}

/**
 * « Supprimer mon compte » depuis la fenêtre bloquante des conditions : la
 * **même** suppression que « Mon profil » (`useAccountDeletion` — aperçu,
 * confirmation, `DELETE /api/profile`, toast, accueil), empilée sur la fenêtre
 * (`layer="overBlocking"`). Échap et « Annuler » ne ferment que la
 * confirmation (pile des modales) ; la fenêtre des conditions reste.
 *
 * Chargée au clic seulement (`TermsAcceptanceModal`) : ses textes vivent dans
 * l'espace `profile`, que la mise en page racine ne sert pas — l'anglais est
 * chargé ici sous `/en` (un échec retombe sur le français).
 */
export function TermsAccountDeletion({ onClose, onReady }: Readonly<TermsAccountDeletionProps>) {
  const locale = useAppLocale();
  const english = useEnglishMessagesUntilRemount(locale, englishProfile);
  if (english.waiting) return null;
  return (
    <ProfileTextProvider locale={locale} messages={english.english ?? undefined}>
      <TermsAccountDeletionFlow onClose={onClose} onReady={onReady} />
    </ProfileTextProvider>
  );
}

function TermsAccountDeletionFlow({ onClose, onReady }: Readonly<TermsAccountDeletionProps>) {
  const text = useProfileText();
  const { start, dialog, confirming } = useAccountDeletion({ text, onCancel: onClose, layer: "overBlocking" });
  useEffect(() => {
    if (confirming) onReady?.();
  }, [confirming, onReady]);
  // Montée par le clic : l'aperçu part une fois (le double effet du mode strict n'en lance pas deux).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);
  return <>{dialog}</>;
}
