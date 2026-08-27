"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CyberButton } from "@/components/cyber";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  RECRUITMENT_DOMAIN_LABELS,
  type RecruitmentAd,
  buildRecruitmentPreview,
  recruitmentAdAnchor,
  shouldShowRecruitmentModal,
} from "@/lib/shared/recruitment";
import styles from "./recruitment-highlight.module.css";

/** Aperçu plus généreux qu'en carte : la modale a la place, mais pas un mur de texte. */
const MODAL_PREVIEW_MAX = 320;

/**
 * Page où la modale d'accueil n'a plus lieu d'être : le visiteur y lit déjà les
 * annonces. La lui imposer serait doublement fautif — elle relance quelqu'un de
 * déjà venu, et elle se superpose à la modale de lecture d'une annonce ouverte
 * par lien profond, deux boîtes de dialogue empilées dont l'ordre visuel et
 * l'ordre d'ouverture ne coïncident pas. La banderole, non modale, reste
 * affichée.
 */
const AD_PAGE_PATH = "/recrutement";

/**
 * Met en avant, sur l'ensemble du site, l'annonce de recrutement urgente
 * renvoyée par `/api/recruitment/highlight` — soit une banderole discrète
 * (`highlight = "BANNER"`), soit une modale (`highlight = "MODAL"`).
 *
 * L'endpoint ne renvoie **qu'une** annonce, quel que soit le nombre d'annonces
 * marquées urgentes : la plus haute active l'emporte, les autres attendent leur
 * tour. Empiler des modales à l'arrivée d'un visiteur serait insupportable.
 *
 * La banderole se ferme pour la session courante (`sessionStorage`, par annonce).
 * La modale est plus intrusive : une fois affichée, elle ne réapparaît pas avant
 * 7 jours pour le même utilisateur (`localStorage`, horodatage par annonce), même
 * s'il quitte la page sans la fermer. Changer l'annonce mise en avant repart avec
 * une clé neuve, donc une nouvelle annonce urgente peut réapparaître aussitôt.
 *
 * Les deux formes ne montrent qu'un **aperçu** de la description : la lecture
 * complète se fait sur `/recrutement#annonce-<id>`, qui ouvre l'annonce en grand.
 */
export function RecruitmentHighlight() {
  const [ad, setAd] = useState<RecruitmentAd | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const onAdPage = usePathname() === AD_PAGE_PATH;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recruitment/highlight")
      .then((res) => (res.ok ? res.json() : { ad: null }))
      .then((data: { ad: RecruitmentAd | null }) => {
        if (cancelled || !data.ad) return;
        const found = data.ad;
        // La décision de masquer est prise **avant** de publier l'annonce, dans
        // le même lot de mises à jour : un aller-retour par effet laisserait la
        // modale peindre une image avant de se refermer.
        let hidden = false;
        try {
          if (found.highlight === "MODAL") {
            // Fenêtre hebdomadaire : horodatage du dernier affichage.
            const raw = localStorage.getItem(seenKey(found.id));
            hidden = !shouldShowRecruitmentModal(raw === null ? null : Number(raw), Date.now());
          } else {
            // La banderole se referme pour la seule session courante.
            hidden = sessionStorage.getItem(dismissKey(found.id)) === "1";
          }
        } catch {
          // Stockage indisponible (mode privé) : on affiche l'annonce.
        }
        setAd(found);
        if (hidden) setDismissed(true);
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

  const visible = Boolean(ad) && !dismissed && ad?.highlight === "MODAL" && !onAdPage;
  // Le hook doit être appelé à chaque rendu : il ne s'active que si `open`.
  const dialogRef = useDialogBehavior({ open: visible, onClose: dismiss });

  // Annonce déjà comptée comme vue pendant cette page.
  const recordedFor = useRef<number | null>(null);

  // La modale « compte » comme vue dès qu'elle est affichée, même si le visiteur
  // quitte la page sans la fermer. L'horodatage n'est donc posé qu'ici, à
  // l'affichage réel : traverser la page de recrutement, où elle est tue, ne
  // doit pas brûler la fenêtre de 7 jours sans que rien n'ait été montré.
  useEffect(() => {
    if (!visible || !ad || recordedFor.current === ad.id) return;
    recordedFor.current = ad.id;
    try {
      localStorage.setItem(seenKey(ad.id), String(Date.now()));
    } catch {
      // Stockage indisponible : l'affichage reste correct, la fenêtre non tenue.
    }
  }, [visible, ad]);

  if (!ad || dismissed || ad.highlight === "NONE") return null;
  // La modale se tait sur la page de recrutement (voir `AD_PAGE_PATH`).
  if (ad.highlight === "MODAL" && onAdPage) return null;

  const meta = [ad.teamName, RECRUITMENT_DOMAIN_LABELS[ad.domain], ad.roles]
    .filter(Boolean)
    .join(" · ");
  // Lien profond : la page de recrutement ouvre directement l'annonce en grand.
  const anchor = recruitmentAdAnchor(ad.id);
  const adHref = `${AD_PAGE_PATH}#${anchor}`;

  if (ad.highlight === "BANNER") {
    return (
      <div className={styles.banner} role="region" aria-label="Annonce de recrutement">
        <span className={styles.bannerDot} aria-hidden="true" />
        <span className={styles.bannerText}>
          <span className={styles.bannerTag}>Recrutement</span>
          <span className={styles.bannerTitle}>{ad.title}</span>
          {meta && <span className={styles.bannerMeta}>{meta}</span>}
        </span>
        {onAdPage ? (
          // Déjà sur la page : un `<Link>` vers la même route ne changerait le
          // fragment que par `pushState`, qui n'émet aucun événement — la modale
          // de lecture ne s'ouvrirait pas. L'ancre native, elle, déclenche bien
          // `hashchange`.
          <a href={`#${anchor}`} className={styles.bannerLink}>
            Voir →
          </a>
        ) : (
          <Link href={adHref} className={styles.bannerLink}>
            Voir →
          </Link>
        )}
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
  const preview = buildRecruitmentPreview(ad.body, MODAL_PREVIEW_MAX);

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={dismiss}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Annonce de recrutement urgente"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="eyebrow">RECRUTEMENT · URGENT</span>
        <h2 className={styles.modalTitle}>{ad.title}</h2>
        {meta && <p className={styles.modalMeta}>{meta}</p>}
        {preview.text && <p className={styles.modalBody}>{preview.text}</p>}
        <div className={styles.modalActions}>
          <CyberButton variant="ghost" onClick={dismiss}>
            Plus tard
          </CyberButton>
          {/* La lecture complète se fait toujours sur la page de recrutement :
              la modale d'accueil reste un teaser, jamais un pavé de 2 000 signes. */}
          <CyberButton variant={ad.contactUrl ? "ghost" : "primary"} asChild>
            <Link href={adHref} onClick={dismiss}>
              Lire l&apos;annonce →
            </Link>
          </CyberButton>
          {ad.contactUrl && (
            <CyberButton variant="primary" asChild>
              <a href={ad.contactUrl} target="_blank" rel="noopener noreferrer" onClick={dismiss}>
                Postuler →
              </a>
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
