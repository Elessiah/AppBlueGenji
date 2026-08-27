"use client";

import { CyberButton, Pill, ScrollArea } from "@/components/cyber";
import { ContactTags } from "@/components/recruitment/ContactTags";
import { RecruitmentBody } from "@/components/recruitment/RecruitmentBody";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { RECRUITMENT_DOMAIN_LABELS, type RecruitmentAd } from "@/lib/shared/recruitment";
import styles from "./AdDetailModal.module.css";

interface AdDetailModalProps {
  ad: RecruitmentAd;
  onClose: () => void;
}

/**
 * Lecture d'une annonce en grand. Les descriptions dépassent régulièrement le
 * millier de signes : la carte n'en montre qu'un aperçu et renvoie ici, où le
 * texte est mis en forme (`RecruitmentBody`) et défile dans sa propre zone,
 * en-tête et actions restant visibles.
 *
 * Comportement modal complet via `useDialogBehavior` : `Échap`, piège à focus,
 * arrière-plan figé, focus rendu au déclencheur à la fermeture.
 */
export function AdDetailModal({ ad, onClose }: AdDetailModalProps) {
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const titleId = `annonce-titre-${ad.id}`;

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <div className={styles.tags}>
            <Pill variant="blue">{RECRUITMENT_DOMAIN_LABELS[ad.domain]}</Pill>
            {ad.highlight !== "NONE" && <Pill variant="live">Urgent</Pill>}
            {!ad.active && <Pill>Inactif</Pill>}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Fermer l'annonce"
            title="Fermer"
          >
            ✕
          </button>
        </header>

        <h2 id={titleId} className={styles.title}>
          {ad.title}
        </h2>
        {ad.teamName && <p className={styles.team}>{ad.teamName}</p>}
        {ad.roles && <p className={styles.roles}>Missions : {ad.roles}</p>}

        <ScrollArea
          orientation="y"
          className={styles.bodyScroll}
          ariaLabel={`Description de l'annonce ${ad.title}`}
        >
          <RecruitmentBody body={ad.body} />
        </ScrollArea>

        <ContactTags ad={ad} />

        <div className={styles.actions}>
          <CyberButton variant="ghost" onClick={onClose}>
            Fermer
          </CyberButton>
          {ad.contactUrl && (
            <CyberButton variant="primary" asChild>
              <a href={ad.contactUrl} target="_blank" rel="noopener noreferrer">
                Postuler →
              </a>
            </CyberButton>
          )}
        </div>
      </div>
    </div>
  );
}
