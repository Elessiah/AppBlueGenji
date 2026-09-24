"use client";

import { useEffect, useState, type FocusEvent, type PointerEvent } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import { UrgentPill } from "@/components/recruitment/UrgentPill";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import type { CountdownOverride } from "@/lib/shared/pausable-countdown";
import {
  RECRUITMENT_BANNER_COOKIE,
  RECRUITMENT_BANNER_ROTATION_MS,
  RECRUITMENT_DOMAIN_LABELS,
  RECRUITMENT_MODAL_COOKIE,
  RECRUITMENT_MODAL_COOKIE_MAX_AGE,
  RECRUITMENT_PRIORITY_EXPOSURE,
  type RecruitmentAd,
  buildRecruitmentPreview,
  isRecruitmentBannerRotating,
  recruitmentAdAnchor,
  recruitmentModalStart,
  serializeRecruitmentSeen,
} from "@/lib/shared/recruitment";
import styles from "./recruitment-highlight.module.css";

/** Aperçu plus généreux qu'en carte : la modale a la place, mais pas un mur de texte. */
const MODAL_PREVIEW_MAX = 320;

/**
 * Pose un cookie de mise en avant. `document.cookie` plutôt qu'un aller-retour :
 * la fermeture est locale, le serveur n'a rien à en faire avant le prochain
 * chargement. `SameSite` strict — ce cookie ne dit rien d'utile à une requête
 * tierce. La valeur ne porte que des identifiants d'annonce.
 */
function writeSeenCookie(name: string, value: string, maxAge?: number): void {
  try {
    document.cookie =
      `${name}=${value}; path=/; samesite=strict` +
      (maxAge === undefined ? "" : `; max-age=${maxAge}`);
  } catch {
    // Cookies refusés : la fermeture reste effective pour la vue courante.
  }
}

/**
 * Le focus vient-il du clavier ? Un clic de souris donne aussi le focus à un
 * bouton : compté comme un focus, il figerait la banderole jusqu'au clic
 * suivant ailleurs. Un navigateur qui ne connaît pas `:focus-visible` lève une
 * erreur : on s'arrête alors, dans le doute.
 */
function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return true;
  }
}

function adMeta(ad: RecruitmentAd): string {
  return [ad.teamName, RECRUITMENT_DOMAIN_LABELS[ad.domain], ad.roles].filter(Boolean).join(" · ");
}

/** Lien profond : la page de recrutement ouvre directement l'annonce en grand. */
function adHref(ad: RecruitmentAd): string {
  return `/recrutement#${recruitmentAdAnchor(ad.id)}`;
}

/**
 * Nom accessible du lien de la banderole : « Voir → » seul ne dit pas où il
 * mène (WCAG 2.4.4), surtout lu hors contexte dans une liste de liens. Il
 * **commence** par le mot affiché, sans quoi la commande vocale « cliquer sur
 * Voir » ne le trouverait plus (WCAG 2.5.3).
 */
export function bannerLinkLabel(ad: Pick<RecruitmentAd, "title">): string {
  return `Voir l'annonce : ${ad.title}`;
}

/**
 * Met en avant les annonces de recrutement selon leur **statut** : la modale
 * d'arrivée porte les prioritaires, la banderole discrète fait défiler
 * prioritaires et importantes. Les facultatives n'apparaissent qu'en page.
 *
 * **Tout est décidé côté serveur**, et c'est ce qui compte. Le composant allait
 * chercher son annonce lui-même (`fetch` dans un `useEffect`) puis lisait
 * `localStorage` pour savoir s'il devait l'afficher : il ne peignait donc rien
 * avant l'hydratation. La modale étant le plus gros bloc de l'accueil sur
 * mobile, elle en **était** le LCP — 4,4 s, dont 3,8 s de seul délai de rendu.
 *
 * La mise en page racine résout donc les annonces **et** la décision
 * d'affichage, et les passe en props : le balisage part dans le HTML initial. Le
 * prix est un **cookie** à la place de `localStorage` — c'est le seul état de
 * navigateur qu'une requête transporte. Il est documenté sur `/rgpd`.
 *
 * La banderole se referme pour la visite (cookie de session), la modale pour
 * sept jours ({@link RECRUITMENT_MODAL_COOKIE_MAX_AGE}). La valeur est la liste
 * des identifiants montrés — pour la modale, des pages réellement affichées :
 * une annonce qui s'ajoute, ou qu'on n'a jamais feuilletée, la fait reparaître.
 */
export function RecruitmentHighlight({
  modalAds,
  modalSilenced,
  modalSeen,
  bannerAds,
  bannerDismissed,
  onAdPage,
}: {
  /** Prioritaires publiées : les pages de la modale d'arrivée. */
  modalAds: readonly RecruitmentAd[];
  /** La modale doit se taire quoi qu'il arrive (choix de confidentialité dû). */
  modalSilenced: boolean;
  /** Prioritaires que ce visiteur a déjà vues (cookie) : elles le restent. */
  modalSeen: readonly number[];
  /** Prioritaires puis importantes publiées : ce qui défile dans la banderole. */
  bannerAds: readonly RecruitmentAd[];
  /** Le cookie dit que ce visiteur a déjà fermé la banderole telle qu'elle est. */
  bannerDismissed: boolean;
  /** On est sur `/recrutement`, où la modale se tait (le visiteur y lit déjà les annonces). */
  onAdPage: boolean;
}) {
  // Ouverte sur la première prioritaire jamais vue ; toutes vues, elle se tait.
  const modalStart = recruitmentModalStart(modalAds.map((ad) => ad.id), modalSeen);
  const showModal = modalStart !== null && !modalSilenced && !onAdPage;
  return (
    <>
      {!bannerDismissed && bannerAds.length > 0 && (
        <RecruitmentBanner ads={bannerAds} onAdPage={onAdPage} />
      )}
      {showModal && (
        <RecruitmentArrivalModal
          ads={modalAds}
          seenIds={modalSeen}
          startIndex={modalStart}
        />
      )}
    </>
  );
}

/**
 * Banderole discrète : une annonce à la fois, la suivante toutes les
 * {@link RECRUITMENT_BANNER_ROTATION_MS} ms.
 *
 * Le défilement s'arrête de lui-même dans trois cas, et aucun n'est une option
 * à cocher : au **survol à la souris** ou au **focus clavier** (on ne retire pas
 * une annonce de sous le pointeur ni sous le clavier), et dès que le **régime de
 * charge** coupe les animations décoratives — page sans focus, machine à la
 * peine, joueur en match, mouvement réduit demandé (`useClientPower`) : une
 * banderole qui tourne derrière un jeu est une image prise au jeu. Un bouton
 * pause le fige pour de bon (WCAG 2.2.2), et les flèches parcourent les
 * annonces à la main.
 *
 * Le bouton pose un **choix explicite qui prime** sur le survol et le focus
 * ({@link isRecruitmentBannerRotating}) : « Reprendre » relance sur-le-champ,
 * et s'efface au prochain survol ou focus, qui suspendent de nouveau.
 */
function RecruitmentBanner({
  ads,
  onAdPage,
}: {
  ads: readonly RecruitmentAd[];
  onAdPage: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const [override, setOverride] = useState<CountdownOverride>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { decorativeMotion } = useClientPower();

  const count = ads.length;
  const multiple = count > 1;
  const paused = override === "PAUSED";
  const rotating = isRecruitmentBannerRotating({ count, decorativeMotion, override, hovered, focused });
  // Un nouveau survol ou focus rend la main à la règle ordinaire.
  const releaseResume = () => setOverride((value) => (value === "RUNNING" ? null : value));

  // Un minuteur par annonce affichée, relancé à chaque changement : un clic sur
  // « suivante » redonne à la nouvelle annonce son plein temps de lecture.
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), RECRUITMENT_BANNER_ROTATION_MS);
    return () => clearTimeout(timer);
  }, [rotating, index, count]);

  if (dismissed || count === 0) return null;

  // Modulo : la liste vient du serveur et peut raccourcir d'un rendu à l'autre.
  const position = index % count;
  const ad = ads[position];
  const meta = adMeta(ad);
  const anchor = recruitmentAdAnchor(ad.id);
  const urgent = RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].urgent;

  function dismiss() {
    writeSeenCookie(RECRUITMENT_BANNER_COOKIE, serializeRecruitmentSeen(ads.map((a) => a.id)));
    setDismissed(true);
  }

  function step(direction: -1 | 1) {
    setIndex((i) => (i + direction + count) % count);
  }

  // Au doigt, un tap émet l'entrée du pointeur mais jamais sa sortie : compté
  // comme un survol, il figerait la banderole pour toute la visite.
  function onPointerEnter(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    releaseResume();
    setHovered(true);
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    if (!isKeyboardFocus(event.target)) return;
    releaseResume();
    setFocused(true);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Le focus qui passe d'un bouton à l'autre de la banderole ne relance rien.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }

  return (
    <div
      className={styles.banner}
      role="region"
      aria-label="Annonces de recrutement"
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => setHovered(false)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span className={styles.bannerDot} aria-hidden="true" />
      {/* Annoncé seulement quand le lecteur change lui-même d'annonce : un
          défilement automatique lu à voix haute toutes les sept secondes
          couperait la parole à tout le reste de la page. */}
      <span className={styles.bannerText} aria-live={rotating ? "off" : "polite"}>
        <span key={ad.id} className={styles.bannerSlide}>
          {urgent ? <UrgentPill /> : <span className={styles.bannerTag}>Recrutement</span>}
          <span className={styles.bannerTitle}>{ad.title}</span>
          {meta && <span className={styles.bannerMeta}>{meta}</span>}
        </span>
      </span>
      {onAdPage ? (
        // Déjà sur la page : un `<Link>` vers la même route ne changerait le
        // fragment que par `pushState`, qui n'émet aucun événement — la modale
        // de lecture ne s'ouvrirait pas. L'ancre native, elle, déclenche bien
        // `hashchange`.
        <a href={`#${anchor}`} className={styles.bannerLink} aria-label={bannerLinkLabel(ad)}>
          Voir <span aria-hidden="true">→</span>
        </a>
      ) : (
        <Link href={adHref(ad)} className={styles.bannerLink} aria-label={bannerLinkLabel(ad)}>
          Voir <span aria-hidden="true">→</span>
        </Link>
      )}
      {multiple && (
        <span className={styles.bannerControls}>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => step(-1)}
            aria-label="Annonce précédente"
          >
            ‹
          </button>
          <span className={styles.bannerCount}>
            <span aria-hidden="true">
              {position + 1}/{count}
            </span>
            <span className="sr-only">
              Annonce {position + 1} sur {count}
            </span>
          </span>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => step(1)}
            aria-label="Annonce suivante"
          >
            ›
          </button>
          {/* Pas de pause à offrir quand rien ne défile : le régime de charge a
              déjà figé la banderole, un bouton de plus ne dirait rien de vrai. */}
          {decorativeMotion && (
            <button
              type="button"
              className={styles.bannerButton}
              onClick={() => setOverride(paused ? "RUNNING" : "PAUSED")}
              aria-pressed={paused}
              aria-label={paused ? "Reprendre le défilement des annonces" : "Mettre en pause le défilement des annonces"}
              title={paused ? "Reprendre" : "Pause"}
            >
              {paused ? "▶" : "❚❚"}
            </button>
          )}
        </span>
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

/**
 * Modale d'arrivée : **une** modale pour toutes les prioritaires, qui se
 * feuillette. Empiler une modale par annonce serait insupportable, et n'en
 * montrer qu'une laissait les autres prioritaires lettre morte — c'était
 * l'ancien défaut. Elle ne tourne pas d'elle-même : un texte qui change pendant
 * qu'on le lit est un texte qu'on ne lit pas.
 */
function RecruitmentArrivalModal({
  ads,
  seenIds,
  startIndex,
}: {
  ads: readonly RecruitmentAd[];
  seenIds: readonly number[];
  startIndex: number;
}) {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(startIndex);
  // Pages **réellement affichées**, plus celles que le cookie tenait déjà. Tout
  // compter comme vu dès l'ouverture taisait pour sept jours les prioritaires
  // qu'un visiteur n'avait jamais feuilletées : fermée sur la page 1, la modale
  // ne lui aurait jamais montré les suivantes. Elle revient donc, à la visite
  // suivante, sur la première qu'il n'a pas vue.
  const [viewed, setViewed] = useState<ReadonlySet<number>>(
    () => new Set([...seenIds, ads[startIndex % ads.length].id]),
  );

  // Valeur du cookie : les prioritaires vues, dans l'ordre de la modale.
  const seenValue = serializeRecruitmentSeen(ads.filter((a) => viewed.has(a.id)).map((a) => a.id));

  function go(direction: -1 | 1) {
    const next = (index + direction + ads.length) % ads.length;
    setIndex(next);
    setViewed((prev) => (prev.has(ads[next].id) ? prev : new Set([...prev, ads[next].id])));
  }

  function dismiss() {
    writeSeenCookie(RECRUITMENT_MODAL_COOKIE, seenValue, RECRUITMENT_MODAL_COOKIE_MAX_AGE);
    setOpen(false);
  }

  // Le hook doit être appelé à chaque rendu : il ne s'active que si `open`.
  const dialogRef = useDialogBehavior({ open, onClose: dismiss });
  const backdrop = useBackdropDismiss(dismiss);

  // Une page « compte » comme vue dès qu'elle est affichée, même si le visiteur
  // quitte le site sans fermer la modale. La marque n'est posée qu'ici, à
  // l'affichage réel : traverser la page de recrutement, où elle est tue, ne
  // doit pas brûler la fenêtre de sept jours sans que rien n'ait été montré.
  useEffect(() => {
    if (!open) return;
    writeSeenCookie(RECRUITMENT_MODAL_COOKIE, seenValue, RECRUITMENT_MODAL_COOKIE_MAX_AGE);
  }, [open, seenValue]);

  if (!open) return null;

  const count = ads.length;
  const position = index % count;
  const ad = ads[position];
  const meta = adMeta(ad);
  const preview = buildRecruitmentPreview(ad.body, MODAL_PREVIEW_MAX);
  const titleId = `recruitment-arrival-title-${ad.id}`;

  return (
    <div className={styles.modalOverlay} role="presentation" {...backdrop}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.modalEyebrow}>
          <span className="eyebrow">RECRUTEMENT</span>
          <UrgentPill />
        </div>
        <h2 id={titleId} className={styles.modalTitle}>
          {ad.title}
        </h2>
        {meta && <p className={styles.modalMeta}>{meta}</p>}
        {preview.text && <p className={styles.modalBody}>{preview.text}</p>}

        {count > 1 && (
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.pagerButton}
              onClick={() => go(-1)}
            >
              ← Précédente
            </button>
            <span className={styles.pagerCount} aria-live="polite">
              <span aria-hidden="true">
                {position + 1} / {count}
              </span>
              <span className="sr-only">
                Annonce {position + 1} sur {count}
              </span>
            </span>
            <button
              type="button"
              className={styles.pagerButton}
              onClick={() => go(1)}
            >
              Suivante →
            </button>
          </div>
        )}

        <div className={styles.modalActions}>
          <CyberButton variant="ghost" onClick={dismiss}>
            Plus tard
          </CyberButton>
          {/* La lecture complète se fait toujours sur la page de recrutement :
              la modale d'accueil reste un teaser, jamais un pavé de 2 000 signes. */}
          <CyberButton variant={ad.contactUrl ? "ghost" : "primary"} asChild>
            <Link href={adHref(ad)} onClick={dismiss}>
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
