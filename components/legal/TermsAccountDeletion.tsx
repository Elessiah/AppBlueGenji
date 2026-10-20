"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useAccountDeletion } from "@/components/account/use-account-deletion";
import { englishProfile } from "@/components/i18n/english-loader-profile";
import type { PendingAccountDeletion } from "@/components/account/account-deletion-preview";
import { useAppLocale } from "@/components/i18n/locale-context";
import { ProfileTextProvider, useProfileText } from "@/components/i18n/profile-text";
import { useEnglishMessagesUntilRemount } from "@/components/i18n/use-english-messages";

export interface TermsAccountDeletionProps {
  /** La confirmation est annulée : la fenêtre des conditions reprend la main. */
  onClose: () => void;
  /** La confirmation s'ouvre : le bouton de la fenêtre quitte son libellé d'attente. */
  onReady?: () => void;
  /** L'aperçu, lancé par la fenêtre au clic (en parallèle du chargement de ce code). */
  preview?: Promise<PendingAccountDeletion>;
}

/**
 * « Supprimer mon compte » depuis la fenêtre bloquante des conditions : la
 * **même** suppression que « Mon profil » (`useAccountDeletion` — aperçu,
 * confirmation, `DELETE /api/profile`, toast, accueil), empilée sur la fenêtre
 * (`layer="overBlocking"`). Échap et « Annuler » ne ferment que la
 * confirmation (pile des modales) ; la fenêtre des conditions reste.
 *
 * Chargée au clic seulement (`TermsAcceptanceModal`, avec l'aperçu et l'anglais en parallèle) : ses textes vivent dans
 * l'espace `profile`, que la mise en page racine ne sert pas — l'anglais est
 * chargé ici sous `/en` (un échec retombe sur le français).
 */
export function TermsAccountDeletion({ onClose, onReady, preview }: Readonly<TermsAccountDeletionProps>) {
  const locale = useAppLocale();
  const english = useEnglishMessagesUntilRemount(locale, englishProfile);
  if (english.waiting) return null;
  return (
    <ProfileTextProvider locale={locale} messages={english.english ?? undefined}>
      <TermsAccountDeletionFlow onClose={onClose} onReady={onReady} preview={preview} />
    </ProfileTextProvider>
  );
}

function TermsAccountDeletionFlow({ onClose, onReady, preview }: Readonly<TermsAccountDeletionProps>) {
  const text = useProfileText();
  const { start, dialog, confirming } = useAccountDeletion({ text, onCancel: onClose, layer: "overBlocking" });
  // Lu par une ref : la fenêtre passe un rappel neuf à chaque rendu, qui ne
  // doit pas rejouer l'effet (et re-rendre la fenêtre) tant que la confirmation est ouverte.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Avant la peinture (`useLayoutEffect`) : la minuterie de préparation de la
  // fenêtre est levée dans le même rendu que la confirmation — un effet passif,
  // joué après la peinture, laissait un instant où elle pouvait encore se
  // déclencher et retirer une confirmation déjà affichée (clic perdu).
  useLayoutEffect(() => {
    if (confirming) onReadyRef.current?.();
  }, [confirming]);
  // Montée par le clic : l'aperçu part une fois (le double effet du mode strict n'en lance pas deux).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start(preview);
  }, [start, preview]);
  return <>{dialog}</>;
}
