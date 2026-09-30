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
  formatTermsDate,
  type TermsRequest,
} from "@/lib/shared/terms-of-use";
import {
  TERMS_POSTPONED_COOKIE,
  TERMS_POSTPONED_MAX_AGE_SECONDS,
  TERMS_POSTPONED_VALUE,
  termsModalSilencedOn,
} from "@/lib/shared/global-modals";
import styles from "./TermsAcceptanceModal.module.css";

/**
 * Pose (douze heures au plus) ou efface le report « Plus tard ».
 * `lax` et non `strict` : un lien ouvert depuis Discord est une navigation
 * venue d'un autre site, qui n'emporte pas un cookie `strict` — la modale
 * reviendrait justement dans le cas que le report doit couvrir.
 */
function writePostponedCookie(postponed: boolean): void {
  try {
    document.cookie = postponed
      ? `${TERMS_POSTPONED_COOKIE}=${TERMS_POSTPONED_VALUE}; path=/; samesite=lax; max-age=${TERMS_POSTPONED_MAX_AGE_SECONDS}`
      : `${TERMS_POSTPONED_COOKIE}=; path=/; samesite=lax; max-age=0`;
  } catch {
    // Cookies refusés : le report reste effectif pour la vue courante.
  }
}

interface TermsAcceptanceModalProps {
  /** Le compte gère une équipe sans avoir accepté les conditions en vigueur. */
  initiallyRequired: boolean;
  /**
   * Pourquoi la mise en page racine demande l'acceptation : `UPDATED` quand le
   * compte avait accepté une version antérieure — « tu gères désormais une
   * équipe » serait faux pour un gérant de longue date. `null` (rien de dû au
   * chargement, fenêtre rouverte par un geste refusé) : texte d'une première
   * acceptation.
   */
  request?: TermsRequest | null;
  /** Une modale de confidentialité attend une réponse : celle-ci passe après. */
  privacyPending: boolean;
}

/**
 * Conditions d'utilisation présentées à qui **reçoit** la main sur une équipe
 * (propriété transférée, rôle de gérant, fantôme confiée).
 *
 * Celui qui la reçoit n'a fait aucun geste où l'on aurait pu lui demander son
 * accord : on le lui demande donc au passage suivant, sur n'importe quelle
 * page. « Plus tard » ferme la fenêtre sans rien accepter, pour douze heures
 * (cookie `bg_terms_later`, lu par la mise en page racine) — gardé dans le seul
 * état React, le report tombait à chaque chargement complet. Les gestes de
 * gestion restent refusés (`TERMS_ACCEPTANCE_REQUIRED`), et la fenêtre revient
 * dès que l'un d'eux est tenté (`TERMS_REQUIRED_EVENT`), report ou non.
 *
 * Elle se tait sur la page des conditions elle-même, qu'elle invite à lire, et
 * sur la connexion, dont la modale de consentement doit rester seule.
 */
export function TermsAcceptanceModal({ initiallyRequired, request = null, privacyPending }: TermsAcceptanceModalProps) {
  const updated = request === "UPDATED";
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

  const open = mounted && requested && privacyAnswered && !termsModalSilencedOn(pathname);
  const later = () => {
    if (busy) return;
    writePostponedCookie(true);
    setRequested(false);
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
      writePostponedCookie(false);
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
          {updated ? "Les conditions d'utilisation ont changé" : "Tu gères désormais une équipe"}
        </h2>
        <ScrollArea orientation="y" className={styles.body} ariaLabel="Présentation des conditions">
          {updated ? (
            <p className={styles.text}>
              Tu es propriétaire ou gérant d&apos;une équipe. Les conditions d&apos;utilisation du site ont été
              mises à jour (version {TERMS_VERSION}, en vigueur depuis le {formatTermsDate()}) : accepte-les
              pour continuer à gérer ton équipe — logo, membres, invitations.
            </p>
          ) : (
            <p className={styles.text}>
              Tu es propriétaire ou gérant d&apos;une équipe. Avant de la gérer — logo, membres, invitations —,
              accepte les conditions d&apos;utilisation du site.
            </p>
          )}
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
