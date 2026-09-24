"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { PRIVACY_CHANGES_ANSWERED_EVENT } from "@/lib/shared/privacy-changes";
import {
  TERMS_CHECKBOX_LABEL,
  TERMS_PATH,
  TERMS_REQUIRED_EVENT,
  TERMS_VERSION,
} from "@/lib/shared/terms-of-use";
import styles from "./TermsAcceptanceModal.module.css";

interface TermsAcceptanceModalProps {
  /** Le compte gère une équipe sans avoir accepté les conditions en vigueur. */
  initiallyRequired: boolean;
  /** Une modale de confidentialité attend une réponse : celle-ci passe après. */
  privacyPending: boolean;
}

/**
 * Conditions d'utilisation présentées à qui **reçoit** la main sur une équipe
 * (propriété transférée, rôle de gérant, fantôme confiée).
 *
 * Celui qui la reçoit n'a fait aucun geste où l'on aurait pu lui demander son
 * accord : on le lui demande donc au passage suivant, sur n'importe quelle
 * page. « Plus tard » ferme la fenêtre sans rien enregistrer — les gestes de
 * gestion restent refusés (`TERMS_ACCEPTANCE_REQUIRED`), et la fenêtre revient
 * dès que l'un d'eux est tenté (`TERMS_REQUIRED_EVENT`).
 *
 * Elle se tait sur la page des conditions elle-même, qu'elle invite à lire.
 */
export function TermsAcceptanceModal({ initiallyRequired, privacyPending }: TermsAcceptanceModalProps) {
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [requested, setRequested] = useState(initiallyRequired);
  const [privacyAnswered, setPrivacyAnswered] = useState(!privacyPending);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onRequired = () => setRequested(true);
    window.addEventListener(TERMS_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(TERMS_REQUIRED_EVENT, onRequired);
  }, []);

  useEffect(() => {
    if (!privacyPending) return;
    const onAnswered = () => setPrivacyAnswered(true);
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
    return () => window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
  }, [privacyPending]);

  const open = mounted && requested && privacyAnswered && pathname !== TERMS_PATH;
  const later = () => {
    if (!busy) setRequested(false);
  };
  const dialogRef = useDialogBehavior({ open, onClose: later, locked: busy });
  const backdrop = useBackdropDismiss(later, busy);

  if (!open) return null;

  const accept = async () => {
    if (busy || !checked) return;
    setBusy(true);
    try {
      const response = await fetch("/api/profile/terms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!response.ok) throw new Error();
      setRequested(false);
      showSuccess("Merci, tu peux gérer ton équipe.");
    } catch {
      showError("Ton acceptation n'a pas pu être enregistrée. Recharge la page, puis réessaie.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} role="presentation" {...backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.modal}
      >
        <span className="eyebrow">CONDITIONS D&apos;UTILISATION</span>
        <h2 id={titleId} className={styles.title}>
          Tu gères désormais une équipe
        </h2>
        <ScrollArea orientation="y" className={styles.body} ariaLabel="Présentation des conditions">
          <p className={styles.text}>
            Tu es propriétaire ou gérant d&apos;une équipe. Avant de la gérer — logo, membres, invitations —,
            accepte les conditions d&apos;utilisation du site.
          </p>
          <p className={styles.text}>
            Elles rappellent notamment que <strong>tu garantis détenir les droits</strong> sur le logo et les
            contenus que tu publies pour ton équipe : un logo de club, de marque ou d&apos;éditeur de jeu ne se
            reprend pas sans l&apos;accord de son titulaire.
          </p>
        </ScrollArea>
        <label className={styles.check}>
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>
            {TERMS_CHECKBOX_LABEL} (
            <Link href={TERMS_PATH} target="_blank" rel="noreferrer">
              lire les conditions
            </Link>
            ).
          </span>
        </label>
        <div className={styles.actions}>
          <CyberButton type="button" variant="ghost" onClick={later} disabled={busy}>
            Plus tard
          </CyberButton>
          <CyberButton type="button" variant="primary" onClick={accept} disabled={busy || !checked}>
            {busy ? "Enregistrement…" : "J'accepte"}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
