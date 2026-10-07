"use client";

import { useEffect, useId, useState } from "react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { richNodes, useShellText } from "@/components/i18n/shell-text";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { PRIVACY_CHANGES_ANSWERED_EVENT } from "@/lib/shared/privacy-changes";
import type { TermsTranslationNote } from "@/lib/shared/french-version-prevails";
import {
  TERMS_PATH,
  TERMS_REQUIRED_EVENT,
  TERMS_VERSION,
  formatTermsDateIn,
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
  /**
   * Note « what you accept is the French text » (`TERMS_TRANSLATION_NOTE`),
   * passée par la mise en page racine sous `/en` seulement : montée sur toutes
   * les pages, la fenêtre ne l'importe pas, et une page française ne la charge pas.
   */
  translationNote?: TermsTranslationNote | null;
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
 *
 * Textes de la coquille (`shell.termsModal`, lot 7b). Sous `/en`, elle lie les
 * conditions anglaises et dit, sous la case, que c'est le texte français — la
 * même `TERMS_VERSION` — que l'on accepte (`translationNote`).
 */
export function TermsAcceptanceModal({
  initiallyRequired,
  request = null,
  privacyPending,
  translationNote = null,
}: Readonly<TermsAcceptanceModalProps>) {
  const updated = request === "UPDATED";
  const { t, rich, locale } = useShellText();
  const { showError, showSuccess } = useToast();
  const titleId = useId();
  // Route sans préfixe de langue : `/en/rgpd` est la page de confidentialité.
  const { path: pathname } = useLocalePathname();
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writePostponedCookie(false);
      setRequested(false);
      showSuccess(t("termsModal.accepted"));
    } catch {
      showError(t("termsModal.failed"));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.modal}
      >
        <span className="eyebrow">{t("termsModal.eyebrow")}</span>
        <h2 id={titleId} className={styles.title}>
          {updated ? t("termsModal.titleUpdated") : t("termsModal.titleFirst")}
        </h2>
        <ScrollArea orientation="y" className={styles.body} ariaLabel={t("termsModal.bodyLabel")}>
          {updated ? (
            <p className={styles.text}>
              {t("termsModal.textUpdated", { version: TERMS_VERSION, date: formatTermsDateIn(locale) })}
            </p>
          ) : (
            <p className={styles.text}>{t("termsModal.textFirst")}</p>
          )}
          <p className={styles.text}>
            {richNodes(rich("termsModal.rights", {}, { strong: (children) => <strong>{richNodes(children)}</strong> }))}
          </p>
        </ScrollArea>
        <label className={styles.check}>
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>
            {richNodes(
              rich("termsModal.checkbox", {}, {
                terms: (children) => (
                  <LocaleLink href={TERMS_PATH} target="_blank" rel="noreferrer">
                    {richNodes(children)}
                  </LocaleLink>
                ),
              }),
            )}
          </span>
        </label>
        {locale === "fr" || !translationNote ? null : (
          <p className={styles.translationNote}>
            {translationNote.text}{" "}
            <a href={TERMS_PATH} target="_blank" rel="noreferrer" hrefLang="fr">
              {translationNote.link}
            </a>
          </p>
        )}
        <div className={styles.actions}>
          <CyberButton type="button" variant="ghost" onClick={later} disabled={busy}>
            {t("termsModal.later")}
          </CyberButton>
          <CyberButton type="button" variant="primary" onClick={accept} disabled={busy || !checked}>
            {busy ? t("termsModal.saving") : t("termsModal.accept")}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
