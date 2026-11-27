"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useAppLocale } from "@/components/i18n/locale-context";
import { getiText, type GetiMessages } from "@/lib/shared/geti/page-text";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { GetiOfficialCard, type OfficialText } from "./GetiOfficialCard";
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
  /** Texte de la carte du serveur officiel de GETI, rendue ici à l'ouverture (pas dans chaque page). */
  official: OfficialText;
}>;

function PublishDialog({
  text,
  categoryTitle,
  channelUrl,
  ourInviteUrl,
  official,
  onClose,
}: PublishProps & Readonly<{ onClose: () => void }>) {
  const locale = useAppLocale();
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const titleId = "geti-publish-title";

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) */
        ref={dialogRef}
        className={styles.modal}
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
        <ScrollArea orientation="y" className={styles.modalScroll} ariaLabel={text.title}>
          <p className={styles.modalText}>{text.intro}</p>
          <ol className={styles.steps}>
            <li>
              <p className={styles.modalText}>{text.stepChannel}</p>
              <CyberButton variant="primary" asChild>
                <a href={channelUrl} target="_blank" rel="noopener noreferrer">
                  {getiText(locale, text.channelLink, { category: categoryTitle })}
                  <span className="sr-only"> {text.newTab}</span>
                </a>
              </CyberButton>
              <p className={styles.modalNote}>
                {text.notMember}{" "}
                <a href={ourInviteUrl} target="_blank" rel="noopener noreferrer" className={styles.modalLink}>
                  {text.joinOurs}
                  <span className="sr-only"> {text.newTab}</span>
                </a>
              </p>
            </li>
            <li>
              <p className={styles.modalText}>{text.stepGeti}</p>
              <GetiOfficialCard text={official} locale={locale} headingLevel={3} />
            </li>
          </ol>
          <p className={styles.modalNote}>{text.rules}</p>
        </ScrollArea>
        <div className={styles.modalActions}>
          <CyberButton variant="ghost" onClick={onClose}>
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
 * mais dans le salon Discord de la catégorie — et, par loyauté envers le réseau
 * dont viennent les annonces, depuis le serveur officiel de GETI.
 */
export function GetiPublishButton(props: PublishProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CyberButton variant="primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {props.text.button}
      </CyberButton>
      {open ? <PublishDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
