"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useAppLocale } from "@/components/i18n/locale-context";
import { getiText, type GetiMessages } from "@/lib/shared/geti/page-text";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { GETI_OFFICIAL_INVITE_URL, GETI_OFFICIAL_SERVER_NAME } from "@/lib/shared/geti/page";
import type { OfficialText } from "./GetiOfficialCard";
import styles from "./geti.module.css";

type PublishText = GetiMessages["publish"];

type PublishProps = Readonly<{
  text: PublishText;
  /** Titre de la catégorie (« Je cherche un joueur »), cité dans le lien du salon. */
  categoryTitle: string;
  /** Lien direct vers le salon de la catégorie sur notre serveur. */
  channelUrl: string;
  /** Invitation de notre serveur, pour qui n'en est pas encore membre. */
  ourInviteUrl: string;
  /** Texte du serveur officiel de GETI (surtitre, « Rejoindre »), repris dans le cadre de la seconde option. */
  official: OfficialText;
  /** Fréquentation du serveur GETI, rendue par le serveur (cache partagé avec la carte de la page) ; rien si Discord se tait. */
  count?: ReactNode;
}>;

/** Nom de notre serveur, écrit sur l'emblème de la première option. */
const OUR_SERVER_NAME = "BlueGenji";

/** La fenêtre seule (exportée pour ses tests de rendu) : `GetiPublishButton` la monte à l'ouverture. */
export function GetiPublishDialog({
  text,
  categoryTitle,
  channelUrl,
  ourInviteUrl,
  official,
  count = null,
  onClose,
}: PublishProps & Readonly<{ onClose: () => void }>) {
  const locale = useAppLocale();
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const titleId = "geti-publish-title";
  const oursId = "geti-publish-ours";
  const getiId = "geti-publish-geti";

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) */
        ref={dialogRef}
        className={`${styles.modal} ${styles.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.modalHead}>
          <h2 id={titleId} className={styles.modalTitle}>
            {text.title}
          </h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label={text.closeLabel}>
            ✕
          </button>
        </header>
        <ScrollArea orientation="y" className={`${styles.modalScroll} ${styles.publishScroll}`} ariaLabel={text.title}>
          <p className={styles.modalText}>{text.intro}</p>
          <div className={styles.options}>
            <section className={`${styles.option} ${styles.optionOurs}`} aria-labelledby={oursId}>
              <header className={styles.optionHead}>
                <span className={styles.optionLogo} aria-hidden="true">
                  {OUR_SERVER_NAME.charAt(0)}
                </span>
                <div className={styles.optionHeadText}>
                  <span className={styles.optionEyebrow}>{text.oursEyebrow}</span>
                  <h3 id={oursId} className={styles.optionTitle}>
                    {text.oursTitle}
                  </h3>
                </div>
              </header>
              <p className={styles.optionText}>{text.stepChannel}</p>
              <CyberButton variant="primary" className={styles.optionAction} asChild>
                <a href={channelUrl} target="_blank" rel="noopener noreferrer">
                  {getiText(locale, text.channelLink, { category: categoryTitle })}
                  <span className="sr-only"> {text.newTab}</span>
                </a>
              </CyberButton>
              <p className={styles.optionFoot}>
                <span>{text.notMember}</span>
                <a href={ourInviteUrl} target="_blank" rel="noopener noreferrer" className={styles.modalLink}>
                  {text.joinOurs}
                  <span className="sr-only"> {text.newTab}</span>
                </a>
              </p>
            </section>
            <section className={`${styles.option} ${styles.optionGeti}`} aria-labelledby={getiId}>
              <header className={styles.optionHead}>
                <span className={styles.optionLogo} aria-hidden="true">
                  {GETI_OFFICIAL_SERVER_NAME.charAt(0)}
                </span>
                <div className={styles.optionHeadText}>
                  <span className={styles.optionEyebrow}>{official.eyebrow}</span>
                  <h3 id={getiId} className={styles.optionTitle}>
                    {text.getiTitle}
                  </h3>
                </div>
              </header>
              <p className={styles.optionText}>{text.stepGeti}</p>
              <CyberButton variant="primary" className={styles.optionAction} asChild>
                <a
                  href={GETI_OFFICIAL_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${getiText(locale, official.joinLabel, { server: GETI_OFFICIAL_SERVER_NAME })} ${text.newTab}`}
                >
                  {official.join}
                </a>
              </CyberButton>
              <div className={styles.optionFoot}>
                <span className={styles.optionServer}>{GETI_OFFICIAL_SERVER_NAME}</span>
                {count}
              </div>
            </section>
          </div>
          <p className={styles.modalNote}>{text.rules}</p>
        </ScrollArea>
        <div className={styles.modalActions}>
          <CyberButton variant="ghost" className={styles.publishClose} onClick={onClose}>
            {text.close}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Bouton « Publier une annonce » et sa fenêtre : on ne publie pas sur le site,
 * mais sur Discord, par l'une de **deux options** présentées dans deux cadres de
 * même poids — le salon de la catégorie sur notre serveur, ou (loyauté envers
 * le réseau dont viennent les annonces) le serveur officiel de GETI, dont le
 * nom, la fréquentation et le bouton « Rejoindre » font partie du second cadre.
 */
export function GetiPublishButton(props: PublishProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CyberButton variant="primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {props.text.button}
      </CyberButton>
      {open ? <GetiPublishDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
