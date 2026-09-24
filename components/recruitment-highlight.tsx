"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  RECRUITMENT_BANNER_COOKIE,
  RECRUITMENT_DOMAIN_LABELS,
  RECRUITMENT_MODAL_COOKIE,
  RECRUITMENT_MODAL_COOKIE_MAX_AGE,
  type RecruitmentAd,
  buildRecruitmentPreview,
  recruitmentAdAnchor,
} from "@/lib/shared/recruitment";
import styles from "./recruitment-highlight.module.css";

/** Aperçu plus généreux qu'en carte : la modale a la place, mais pas un mur de texte. */
const MODAL_PREVIEW_MAX = 320;

/**
 * Met en avant l'annonce de recrutement urgente — banderole discrète
 * (`highlight = "BANNER"`) ou modale (`highlight = "MODAL"`).
 *
 * **Tout est décidé côté serveur**, et c'est le changement qui compte. Le
 * composant allait chercher l'annonce lui-même (`fetch` dans un `useEffect`)
 * puis lisait `localStorage` pour savoir s'il devait l'afficher : il ne
 * peignait donc rien avant l'hydratation. La modale étant le plus gros bloc de
 * l'accueil sur mobile, elle en **était** le LCP — 4,4 s, dont 3,8 s de seul
 * délai de rendu. Ce qui est peint tard est peint tard ; seul l'endroit du
 * rendu pouvait y changer quelque chose, pas un réglage du composant.
 *
 * La mise en page racine résout donc l'annonce **et** la décision d'affichage,
 * et les passe en props : le balisage part dans le HTML initial. Le prix est un
 * **cookie** à la place de `localStorage` — c'est le seul état de navigateur
 * qu'une requête transporte, et le serveur doit savoir qui a déjà écarté
 * l'annonce pour ne pas la réafficher. Il est documenté sur `/rgpd`.
 *
 * L'endpoint `/api/recruitment/highlight` reste en place : il ne sert plus au
 * premier rendu, mais la page de gestion s'en sert encore.
 *
 * La banderole se referme pour la visite (cookie de session), la modale pour
 * sept jours ({@link RECRUITMENT_MODAL_COOKIE_MAX_AGE}). La valeur est
 * l'identifiant de l'annonce : changer l'annonce mise en avant repart donc avec
 * une clé neuve, et une annonce urgente peut réapparaître aussitôt.
 *
 * Les deux formes ne montrent qu'un **aperçu** ; la lecture complète se fait
 * sur `/recrutement#annonce-<id>`.
 */
export function RecruitmentHighlight({
  ad,
  dismissed: dismissedByCookie,
  onAdPage,
}: {
  /** Annonce à mettre en avant, résolue par la mise en page racine. */
  ad: RecruitmentAd | null;
  /** Le cookie dit que ce visiteur l'a déjà écartée. */
  dismissed: boolean;
  /** On est sur `/recrutement`, où la modale se tait (le visiteur y lit déjà les annonces). */
  onAdPage: boolean;
}) {
  // Seul l'état *postérieur au rendu* vit ici : la fermeture faite à l'instant.
  // La décision initiale vient du serveur, sinon on reviendrait à peindre
  // après coup — c'est-à-dire au défaut qu'on corrige.
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = dismissedByCookie || dismissedNow;

  function dismiss() {
    if (ad) {
      // `document.cookie` plutôt qu'un aller-retour : la fermeture est locale,
      // le serveur n'a rien à en faire avant le prochain chargement. `SameSite`
      // strict — ce cookie ne dit rien d'utile à une requête tierce.
      const maxAge =
        ad.highlight === "MODAL" ? `; max-age=${RECRUITMENT_MODAL_COOKIE_MAX_AGE}` : "";
      const name = ad.highlight === "MODAL" ? RECRUITMENT_MODAL_COOKIE : RECRUITMENT_BANNER_COOKIE;
      try {
        document.cookie = `${name}=${ad.id}; path=/; samesite=strict${maxAge}`;
      } catch {
        // Cookies refusés : la fermeture reste effective pour la vue courante.
      }
    }
    setDismissedNow(true);
  }

  const visible = Boolean(ad) && !dismissed && ad?.highlight === "MODAL" && !onAdPage;
  // Le hook doit être appelé à chaque rendu : il ne s'active que si `open`.
  const dialogRef = useDialogBehavior({ open: visible, onClose: dismiss });
  const backdrop = useBackdropDismiss(dismiss);

  // Annonce déjà comptée comme vue pendant cette page.
  const recordedFor = useRef<number | null>(null);

  // La modale « compte » comme vue dès qu'elle est affichée, même si le visiteur
  // quitte la page sans la fermer. La marque n'est donc posée qu'ici, à
  // l'affichage réel : traverser la page de recrutement, où elle est tue, ne
  // doit pas brûler la fenêtre de sept jours sans que rien n'ait été montré.
  useEffect(() => {
    if (!visible || !ad || recordedFor.current === ad.id) return;
    recordedFor.current = ad.id;
    try {
      document.cookie =
        `${RECRUITMENT_MODAL_COOKIE}=${ad.id}; path=/; samesite=strict` +
        `; max-age=${RECRUITMENT_MODAL_COOKIE_MAX_AGE}`;
    } catch {
      // Cookies refusés : l'affichage reste correct, la fenêtre non tenue.
    }
  }, [visible, ad]);

  if (!ad || dismissed || ad.highlight === "NONE") return null;
  // La modale se tait sur la page de recrutement (décidé côté serveur).
  if (ad.highlight === "MODAL" && onAdPage) return null;

  const meta = [ad.teamName, RECRUITMENT_DOMAIN_LABELS[ad.domain], ad.roles]
    .filter(Boolean)
    .join(" · ");
  // Lien profond : la page de recrutement ouvre directement l'annonce en grand.
  const anchor = recruitmentAdAnchor(ad.id);
  const adHref = `/recrutement#${anchor}`;

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
    <div className={styles.modalOverlay} role="presentation" {...backdrop}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Annonce de recrutement urgente"
        tabIndex={-1}
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
