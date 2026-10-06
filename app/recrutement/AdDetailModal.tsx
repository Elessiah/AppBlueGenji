"use client";

import { createPortal } from "react-dom";
import { CyberButton, Pill, ScrollArea } from "@/components/cyber";
import { ContactTags } from "@/components/recruitment/ContactTags";
import { UrgentPill } from "@/components/recruitment/UrgentPill";
import { RecruitmentBody } from "@/components/recruitment/RecruitmentBody";
import { useRecruitmentText } from "@/components/i18n/recruitment-text";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  RECRUITMENT_DOMAIN_PILL,
  RECRUITMENT_PRIORITY_EXPOSURE,
  type RecruitmentAd,
  formatRecruitmentBody,
} from "@/lib/shared/recruitment";
import styles from "./AdDetailModal.module.css";

interface AdDetailModalProps {
  /** Annonce **dans la langue de la page** (`localizeRecruitmentAd`). */
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
export function AdDetailModal({ ad, onClose }: Readonly<AdDetailModalProps>) {
  const { t } = useRecruitmentText();
  const dialogRef = useDialogBehavior({ open: true, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const titleId = `annonce-titre-${ad.id}`;
  // Même source de vérité que le rendu : une description faite d'une seule puce
  // vide se trime en « non vide » mais ne produit aucun bloc affichable.
  const hasBody = formatRecruitmentBody(ad.body).length > 0;

  // Portée dans <body>, comme toutes les modales de page : son `z-index` ne
  // doit pas dépendre de ce que contient le `<main>` qui la rend.
  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.tags}>
            <Pill variant={RECRUITMENT_DOMAIN_PILL[ad.domain]}>{t(`domains.${ad.domain}`)}</Pill>
            {RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].urgent && <UrgentPill />}
            {!ad.active && <Pill variant="neutral">{t("card.inactive")}</Pill>}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t("detail.closeLabel")}
            title={t("detail.closeTitle")}
          >
            ✕
          </button>
        </header>

        <h2 id={titleId} className={styles.title}>
          {ad.title}
        </h2>
        {ad.teamName && <p className={styles.team}>{ad.teamName}</p>}
        {ad.roles && <p className={styles.roles}>{t("card.roles", { roles: ad.roles })}</p>}

        {hasBody ? (
          <ScrollArea
            orientation="y"
            className={styles.bodyScroll}
            ariaLabel={t("detail.bodyLabel", { title: ad.title })}
          >
            <RecruitmentBody body={ad.body} />
          </ScrollArea>
        ) : (
          // Sans description, une zone défilante vide ne serait qu'un cadre de
          // 28 px sous un filet : on dit plutôt qu'il n'y a rien à lire.
          <p className={styles.noBody}>{t("detail.noBody")}</p>
        )}

        <ContactTags ad={ad} />

        <div className={styles.actions}>
          <CyberButton variant="ghost" onClick={onClose}>
            {t("detail.close")}
          </CyberButton>
          {ad.contactUrl && (
            <CyberButton variant="primary" asChild>
              <a href={ad.contactUrl} target="_blank" rel="noopener noreferrer">
                {t("card.apply")}
              </a>
            </CyberButton>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
