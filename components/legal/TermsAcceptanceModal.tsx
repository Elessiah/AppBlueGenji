"use client";

import { useEffect, useId, useState } from "react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { richNodes, useShellText } from "@/components/i18n/shell-text";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useLogout } from "@/components/use-logout";
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
import { termsModalSilencedOn } from "@/lib/shared/global-modals";
import styles from "./TermsAcceptanceModal.module.css";

/** Échap et le voile ne ferment pas une fenêtre bloquante. */
const KEEP_OPEN = () => undefined;

interface TermsAcceptanceModalProps {
  /** Le compte n'a pas accepté les conditions en vigueur. */
  initiallyRequired: boolean;
  /**
   * Pourquoi la mise en page racine demande l'acceptation : `UPDATED` quand le
   * compte avait accepté une version antérieure, `FIRST` s'il n'en a accepté
   * aucune. `null` (rien de dû au chargement, fenêtre rouverte par un geste
   * refusé) : texte d'une première acceptation.
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
 * Conditions d'utilisation présentées à **tout compte connecté** qui n'a pas
 * accepté la version en vigueur (version 6 : décision du 2026-10-19, tous les
 * comptes la réacceptent, pas seulement les gérants d'équipe).
 *
 * La fenêtre est **bloquante** : ni « Plus tard », ni Échap, ni clic sur le
 * voile — on accepte, ou on se déconnecte. Les gestes de gestion restent en
 * outre refusés côté serveur (`TERMS_ACCEPTANCE_REQUIRED`), et ce refus la
 * rouvre (`TERMS_REQUIRED_EVENT`).
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
  const { leaving, logout } = useLogout();
  const dialogRef = useDialogBehavior({ open, onClose: KEEP_OPEN, locked: busy });

  if (!open) return null;

  const accept = async () => {
    if (busy || leaving || !checked) return;
    setBusy(true);
    try {
      const response = await fetch("/api/profile/terms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setRequested(false);
      showSuccess(t("termsModal.accepted"));
    } catch {
      showError(t("termsModal.failed"));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation">
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
          {/* Ce que les conditions laissent faire sans les accepter (`TERMS_FREE_PATHS`) :
              sans ces liens, seul qui connaît les adresses exporterait ou supprimerait son compte. */}
          <p className={styles.text}>
            {richNodes(
              rich("termsModal.exits", {}, {
                privacy: (children) => <LocaleLink href="/rgpd">{richNodes(children)}</LocaleLink>,
                profile: (children) => <LocaleLink href="/profil">{richNodes(children)}</LocaleLink>,
              }),
            )}
          </p>
        </ScrollArea>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={checked}
            // Figée pendant l'envoi : décocher en cours de route rendrait « J'accepte »
            // nativement désactivé au retour. `disabled` natif ici ne coûte aucun
            // focus — il est sur « J'accepte », pressé pour lancer l'envoi — et
            // donne à la case son aspect éteint (`globals.css`, `:disabled`).
            disabled={busy}
            onChange={(event) => setChecked(event.target.checked)}
          />
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
        {/* Pendant la requête, `aria-disabled` + `aria-busy` plutôt que `disabled` :
            le focus reste sur le bouton pressé (un échec se retente au clavier) ;
            `accept` ignore déjà un geste tant que `busy`, la déconnexion un
            second clic (`useLogout`). */}
        <div className={styles.actions}>
          <CyberButton
            type="button"
            variant="ghost"
            onClick={() => {
              if (!busy) void logout();
            }}
            aria-disabled={busy || leaving || undefined}
            aria-busy={leaving || undefined}
          >
            {t("termsModal.logout")}
          </CyberButton>
          <CyberButton
            type="button"
            variant="primary"
            onClick={accept}
            disabled={!checked}
            aria-disabled={busy || leaving || undefined}
            aria-busy={busy || undefined}
          >
            {busy ? t("termsModal.saving") : t("termsModal.accept")}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
