"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import {
  RECRUITMENT_DOMAIN_LABELS,
  type RecruitmentAd,
  shouldShowRecruitmentModal,
} from "@/lib/shared/recruitment";
import styles from "./recruitment-highlight.module.css";

/**
 * Met en avant, sur l'ensemble du site, l'annonce de recrutement urgente
 * renvoyée par `/api/recruitment/highlight` — soit une banderole discrète
 * (`highlight = "BANNER"`), soit une modale (`highlight = "MODAL"`).
 *
 * La banderole se ferme pour la session courante (`sessionStorage`, par annonce).
 * La modale est plus intrusive : une fois affichée, elle ne réapparaît pas avant
 * 7 jours pour le même utilisateur (`localStorage`, horodatage par annonce), même
 * s'il quitte la page sans la fermer. Changer l'annonce mise en avant repart avec
 * une clé neuve, donc une nouvelle annonce urgente peut réapparaître aussitôt.
 */
export function RecruitmentHighlight() {
  const [ad, setAd] = useState<RecruitmentAd | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recruitment/highlight")
      .then((res) => (res.ok ? res.json() : { ad: null }))
      .then((data: { ad: RecruitmentAd | null }) => {
        if (cancelled || !data.ad) return;
        const found = data.ad;
        setAd(found);
        try {
          if (found.highlight === "MODAL") {
            // Modale prioritaire : une seule apparition par fenêtre de 7 jours et
            // par utilisateur. On lit l'horodatage du dernier affichage…
            const raw = localStorage.getItem(seenKey(found.id));
            const seenAt = raw === null ? null : Number(raw);
            if (!shouldShowRecruitmentModal(seenAt, Date.now())) {
              setDismissed(true);
            } else {
              // …et on l'enregistre tout de suite : la modale « compte » comme vue
              // même si l'utilisateur quitte la page sans la fermer.
              localStorage.setItem(seenKey(found.id), String(Date.now()));
            }
          } else if (sessionStorage.getItem(dismissKey(found.id)) === "1") {
            setDismissed(true);
          }
        } catch {
          // Stockage indisponible (mode privé) : on affiche l'annonce.
        }
      })
      .catch(() => {
        // Réseau indisponible : pas de mise en avant, sans bloquer la page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    if (ad) {
      try {
        // La banderole se referme pour la session courante. La modale est déjà
        // horodatée à l'affichage (fenêtre hebdomadaire) : rien à mémoriser ici.
        if (ad.highlight === "BANNER") {
          sessionStorage.setItem(dismissKey(ad.id), "1");
        }
      } catch {
        // Ignore : la fermeture reste effective pour la vue courante.
      }
    }
    setDismissed(true);
  }

  if (!ad || dismissed || ad.highlight === "NONE") return null;

  const meta = [ad.teamName, RECRUITMENT_DOMAIN_LABELS[ad.domain], ad.roles]
    .filter(Boolean)
    .join(" · ");

  if (ad.highlight === "BANNER") {
    return (
      <div className={styles.banner} role="region" aria-label="Annonce de recrutement">
        <span className={styles.bannerDot} aria-hidden="true" />
        <span className={styles.bannerText}>
          <span className={styles.bannerTag}>Recrutement</span>
          <span className={styles.bannerTitle}>{ad.title}</span>
          {meta && <span className={styles.bannerMeta}>{meta}</span>}
        </span>
        <Link href="/recrutement" className={styles.bannerLink}>
          Voir →
        </Link>
        <button
          type="button"
          className={styles.bannerClose}
          onClick={dismiss}
          aria-label="Fermer la banderole de recrutement"
        >
          ✕
        </button>
      </div>
    );
  }

  // highlight === "MODAL"
  return (
    <div className={styles.modalOverlay} role="presentation" onClick={dismiss}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Annonce de recrutement urgente"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="eyebrow">RECRUTEMENT · URGENT</span>
        <h2 className={styles.modalTitle}>{ad.title}</h2>
        {meta && <p className={styles.modalMeta}>{meta}</p>}
        {ad.body && <p className={styles.modalBody}>{ad.body}</p>}
        <div className={styles.modalActions}>
          <CyberButton variant="ghost" onClick={dismiss}>
            Plus tard
          </CyberButton>
          {ad.contactUrl ? (
            <CyberButton variant="primary" asChild>
              <a href={ad.contactUrl} target="_blank" rel="noopener noreferrer" onClick={dismiss}>
                Postuler →
              </a>
            </CyberButton>
          ) : (
            <CyberButton variant="primary" asChild>
              <Link href="/recrutement" onClick={dismiss}>
                Voir l&apos;annonce →
              </Link>
            </CyberButton>
          )}
        </div>
      </div>
    </div>
  );
}

function dismissKey(id: number): string {
  return `bg_recr_highlight_dismissed_${id}`;
}

function seenKey(id: number): string {
  return `bg_recr_highlight_seen_${id}`;
}
