"use client";

import { useEffect, useState, type FocusEvent, type PointerEvent } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useRecruitmentText } from "@/components/i18n/recruitment-text";
import { CyberButton } from "@/components/cyber";
import { UrgentPill } from "@/components/recruitment/UrgentPill";
import { useOptionalToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import type { CountdownOverride } from "@/lib/shared/pausable-countdown";
import {
  RECRUITMENT_BANNER_COOKIE,
  RECRUITMENT_BANNER_ROTATION_MS,
  RECRUITMENT_MODAL_COOKIE,
  RECRUITMENT_MODAL_COOKIE_MAX_AGE,
  RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE,
  RECRUITMENT_MODAL_OFF_COOKIE,
  RECRUITMENT_MODAL_OFF_EVENT,
  RECRUITMENT_MODAL_OFF_MAX_AGE,
  RECRUITMENT_MODAL_OFF_VALUE,
  RECRUITMENT_PRIORITY_EXPOSURE,
  type RecruitmentAd,
  buildRecruitmentPreview,
  isRecruitmentBannerRotating,
  recruitmentAdAnchor,
  recruitmentContactHref,
  recruitmentModalStart,
  serializeRecruitmentSeen,
} from "@/lib/shared/recruitment";
import { FR_RECRUITMENT_TEXT, type RecruitmentText } from "@/lib/shared/recruitment-text";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import styles from "./recruitment-highlight.module.css";

/** « Ne plus afficher » connecté : au-delà, le choix est rendu comme gardé sur ce navigateur seulement. */
const OPT_OUT_TIMEOUT_MS = 10_000;

const OPT_OUT_URL = "/api/recruitment/modal-dismiss";

/** Attente avant la seconde tentative d'un « Ne plus afficher » qui n'a pas abouti. */
const OPT_OUT_RETRY_DELAY_MS = 2_000;

/** Aperçu plus généreux qu'en carte : la modale a la place, mais pas un mur de texte. */
const MODAL_PREVIEW_MAX = 320;

/**
 * Pose un cookie de mise en avant. `document.cookie` plutôt qu'un aller-retour :
 * la fermeture est locale, le serveur n'a rien à en faire avant le prochain
 * chargement. La valeur ne porte que des identifiants d'annonce (ou « 1 »).
 * `SameSite` lax et non strict : un cookie strict n'est pas envoyé quand la
 * visite part d'un autre site (lien Discord, résultat de recherche, retour
 * d'OAuth) — la modale se rouvrirait alors malgré le choix. Lax n'est toujours
 * envoyé à aucune requête tierce embarquée. Rend `false` si le navigateur a
 * refusé le cookie (cookies bloqués). `Secure` en production.
 */
function writeSeenCookie(name: string, value: string, maxAge?: number): boolean {
  try {
    document.cookie =
      `${name}=${value}; path=/; samesite=lax` +
      (maxAge === undefined ? "" : `; max-age=${maxAge}`) +
      // Même règle que le `Set-Cookie` du serveur (et le cookie de session) :
      // `Secure` en production, jamais posé ni remplacé depuis une page en
      // clair — et jamais rétrogradé par la réponse du serveur.
      (process.env.NODE_ENV === "production" ? "; secure" : "");
    return document.cookie.split("; ").includes(`${name}=${value}`);
  } catch {
    // Cookies refusés : la fermeture reste effective pour la vue courante.
    return false;
  }
}

/**
 * Où le « Ne plus afficher » a été gardé : ce navigateur (non connecté), le
 * compte (connecté — écrit, ou rattrapé à la page suivante), ou nulle part
 * (cookie refusé et pas de compte écrit).
 */
export type RecruitmentModalOptOutResult = "BROWSER" | "ACCOUNT" | "NONE";

/**
 * Écriture du « Ne plus afficher » au serveur, d'attente bornée : la modale est
 * déjà fermée, le toast ne doit pas attendre indéfiniment une connexion
 * bloquée (l'abandon tombe dans le repli). `AbortController` + minuterie
 * plutôt que `AbortSignal.timeout`, absent des navigateurs plus anciens
 * (Safari 15) où il ferait échouer chaque appel.
 */
function postOptOut(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPT_OUT_TIMEOUT_MS);
  // `keepalive` : un onglet fermé ou un lien suivi juste après le clic
  // n'annule pas l'écriture (comme `PrivacyChangesModal`).
  return fetch(url, { method: "POST", keepalive: true, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * « Ne plus afficher » : pose le cookie du navigateur **sur-le-champ** (avant
 * tout `await`), puis appelle le serveur — **connecté ou non** : la réponse
 * repose le cookie par `Set-Cookie`, seul moyen de lui garder un an sous
 * Safari / iOS, qui borne à sept jours un cookie posé par script (ITP) ; et,
 * connecté, la route écrit le choix sur le compte. Une écriture du compte qui
 * échoue n'est **pas** un échec pour le lecteur : le cookie posé, la mise en
 * page racine la rattrape à la page connectée suivante
 * (`healRecruitmentModalOff`). Une seule tentative attendue, donc un toast au
 * plus `OPT_OUT_TIMEOUT_MS` après le clic. Les dépendances sont injectables
 * pour les tests (Jest tourne sans DOM).
 */
export async function recordRecruitmentModalOptOut(
  signedIn: boolean,
  {
    writeCookie = writeSeenCookie,
    post = postOptOut,
    cookieKept = optOutCookieKept,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    accountCatchUp = true,
  }: Readonly<{
    writeCookie?: (name: string, value: string, maxAge?: number) => boolean;
    post?: (url: string) => Promise<Pick<Response, "ok" | "status" | "json">>;
    /** Relu après la réponse : son `Set-Cookie` peut avoir gardé le choix là où le script a été refusé. */
    cookieKept?: () => boolean;
    wait?: (ms: number) => Promise<void>;
    /**
     * Le cookie sera-t-il reporté sur le compte si l'écriture échoue ? Non
     * pour un compte qui a réaffiché la fenêtre depuis « Mon profil » (le
     * rattrapage ne touche qu'un compte jamais décidé) : le toast ne promet
     * alors que ce navigateur.
     */
    accountCatchUp?: boolean;
  }> = {},
): Promise<RecruitmentModalOptOutResult> {
  const written = writeCookie(RECRUITMENT_MODAL_OFF_COOKIE, RECRUITMENT_MODAL_OFF_VALUE, RECRUITMENT_MODAL_OFF_MAX_AGE);
  if (!signedIn && written) {
    // Le cookie du script tient : le serveur ne fait que le renouveler, le
    // toast n'attend pas (une connexion faite depuis dans un autre onglet
    // garderait aussi le choix sur le compte ; le toast « ce navigateur » dit
    // alors moins que vrai, jamais faux). Une seconde tentative, en
    // arrière-plan et 2 s plus tard (bascule Wi-Fi / 4G, redémarrage), si la
    // première n'aboutit pas — réseau, délai dépassé ou 5xx (un 502 du proxy
    // ne repose pas le cookie).
    const retryLater = () => {
      wait(OPT_OUT_RETRY_DELAY_MS)
        .then(() => post(OPT_OUT_URL))
        .catch(() => undefined);
    };
    post(OPT_OUT_URL).then((response) => {
      if (response.status >= 500) retryLater();
    }, retryLater);
    return "BROWSER";
  }
  let account = false;
  let accountUnavailable = false;
  try {
    const response = await post(OPT_OUT_URL);
    // 409 (compte supprimé depuis le chargement) ou `account: false` (session
    // finie, déconnexion dans un autre onglet) : hors connexion, le cookie
    // reportera le choix au compte à la prochaine connexion.
    if (response.ok) account = ((await response.json()) as { account?: unknown }).account === true;
    else if (response.status === 503) {
      // Le compte ne peut pas garder le choix (et rien ne le rattrapera) :
      // ce navigateur seulement.
      accountUnavailable =
        ((await response.json()) as { error?: unknown }).error === RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE;
    }
  } catch {
    // Réseau, délai dépassé, corps illisible : le cookie décide de l'issue, ci-dessous.
  }
  if (account) return "ACCOUNT";
  // Refusé au script, le cookie a pu être posé par le `Set-Cookie` de la réponse.
  if (!written && !cookieKept()) return "NONE";
  // Connecté, compte non écrit : rattrapé à la page suivante, depuis le cookie
  // (sauf compte réaffiché depuis « Mon profil » : ce navigateur seulement).
  return signedIn && !accountUnavailable && accountCatchUp ? "ACCOUNT" : "BROWSER";
}

/** Le cookie « Ne plus afficher » est-il lisible sur ce navigateur ? */
function optOutCookieKept(): boolean {
  try {
    return document.cookie.split("; ").includes(`${RECRUITMENT_MODAL_OFF_COOKIE}=${RECRUITMENT_MODAL_OFF_VALUE}`);
  } catch {
    return false;
  }
}

/** Clé du toast qui rend compte d'un « Ne plus afficher » : chaque issue dit où le choix a été gardé. */
export function recruitmentOptOutToast(result: RecruitmentModalOptOutResult): Readonly<{
  kind: "success" | "error";
  key: "dontShowAgainDone" | "dontShowAgainDoneBrowser" | "dontShowAgainUnsaved";
}> {
  switch (result) {
    case "ACCOUNT":
      return { kind: "success", key: "dontShowAgainDone" };
    case "BROWSER":
      return { kind: "success", key: "dontShowAgainDoneBrowser" };
    default:
      return { kind: "error", key: "dontShowAgainUnsaved" };
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

/**
 * Ligne de résumé d'une annonce. Le référent (`teamName`) est saisi en
 * français et n'a pas d'anglais : hors français, il reste sur la carte et la
 * lecture en grand (`lang="fr"`), pas dans ce résumé d'un seul tenant.
 */
function adMeta(ad: RecruitmentAd, text: RecruitmentText): string {
  const referent = text.locale === DEFAULT_LOCALE ? ad.teamName : null;
  return [referent, text.t(`domains.${ad.domain}`), ad.roles].filter(Boolean).join(" · ");
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
export function bannerLinkLabel(ad: Pick<RecruitmentAd, "title">, text: RecruitmentText = FR_RECRUITMENT_TEXT): string {
  return text.t("highlight.viewLabel", { title: ad.title });
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
  modalHeld = false,
  modalSeen,
  modalSeenKept = [],
  bannerAds,
  bannerDismissed,
  bannerSeenKept = [],
  onAdPage,
  modalOptedOut = false,
  signedIn = false,
  accountBackOn = false,
}: Readonly<{
  /** Prioritaires publiées : les pages de la modale d'arrivée. */
  modalAds: readonly RecruitmentAd[];
  /** La modale doit se taire quoi qu'il arrive (choix de confidentialité dû). */
  modalSilenced: boolean;
  /**
   * Une autre fenêtre d'arrivée (certification du tag Discord) a la main sur
   * ce chargement : la modale se tait **jusqu'au prochain chargement complet**,
   * même quand un `router.refresh()` lève ensuite le silence.
   */
  modalHeld?: boolean;
  /** Prioritaires que ce visiteur a déjà vues (cookie) : elles le restent. */
  modalSeen: readonly number[];
  /** Vues ailleurs mais masquées ici (sous `/en`, sans anglais) : gardées au cookie (`recruitmentSeenKept`). */
  modalSeenKept?: readonly number[];
  /** Prioritaires puis importantes publiées : ce qui défile dans la banderole. */
  bannerAds: readonly RecruitmentAd[];
  /** Le cookie dit que ce visiteur a déjà fermé la banderole telle qu'elle est. */
  bannerDismissed: boolean;
  /** Écartées ailleurs mais masquées ici : gardées au cookie de la banderole. */
  bannerSeenKept?: readonly number[];
  /** On est sur `/recrutement`, où la modale se tait (le visiteur y lit déjà les annonces). */
  onAdPage: boolean;
  /** « Ne plus afficher » posé (compte ou navigateur) : la modale ne s'ouvre plus d'elle-même. */
  modalOptedOut?: boolean;
  /** Lecteur connecté : « Ne plus afficher » est aussi gardé sur son compte. */
  signedIn?: boolean;
  /** Compte qui a réaffiché la fenêtre depuis « Mon profil » : aucun rattrapage depuis le cookie. */
  accountBackOn?: boolean;
}>) {
  // Ouverte sur la première prioritaire jamais vue ; toutes vues, elle se tait.
  const modalStart = recruitmentModalStart(modalAds.map((ad) => ad.id), modalSeen);
  // Verrou : une fois tenue par la certification, la modale ne s'ouvre plus
  // sur cette page (une réponse ou un succès relit la mise en page, où la
  // certification n'est plus due — la modale ne doit pas surgir après elle).
  const [held, setHeld] = useState(modalHeld);
  useEffect(() => {
    if (modalHeld) setHeld(true);
  }, [modalHeld]);
  const showModal = modalStart !== null && !modalSilenced && !modalHeld && !held && !modalOptedOut && !onAdPage;
  return (
    <>
      {!bannerDismissed && bannerAds.length > 0 && (
        <RecruitmentBanner ads={bannerAds} keptIds={bannerSeenKept} onAdPage={onAdPage} />
      )}
      {showModal && (
        <RecruitmentArrivalModal
          ads={modalAds}
          seenIds={modalSeen}
          keptIds={modalSeenKept}
          startIndex={modalStart}
          signedIn={signedIn}
          accountBackOn={accountBackOn}
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
  keptIds,
  onAdPage,
}: Readonly<{
  ads: readonly RecruitmentAd[];
  keptIds: readonly number[];
  onAdPage: boolean;
}>) {
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const [override, setOverride] = useState<CountdownOverride>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { decorativeMotion } = useClientPower();
  // Sous `/en`, les annonces arrivent déjà dans leur anglais — celles qui n'en
  // ont pas sont retirées côté serveur (`getRecruitmentSpotlight(locale)`).
  const text = useRecruitmentText();
  const { t } = text;

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
  const meta = adMeta(ad, text);
  const anchor = recruitmentAdAnchor(ad.id);
  const urgent = RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].urgent;

  function dismiss() {
    writeSeenCookie(RECRUITMENT_BANNER_COOKIE, serializeRecruitmentSeen([...keptIds, ...ads.map((a) => a.id)]));
    setDismissed(true);
  }

  function step(direction: -1 | 1) {
    setIndex((i) => (i + direction + count) % count);
  }

  // Au doigt, un tap émet l'entrée du pointeur mais jamais sa sortie : compté
  // comme un survol, il figerait la banderole pour toute la visite.
  function onPointerEnter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    releaseResume();
    setHovered(true);
  }

  function onFocus(event: FocusEvent<HTMLElement>) {
    if (!isKeyboardFocus(event.target)) return;
    releaseResume();
    setFocused(true);
  }

  function onBlur(event: FocusEvent<HTMLElement>) {
    // Le focus qui passe d'un bouton à l'autre de la banderole ne relance rien.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }

  return (
    <section
      className={styles.banner}
      aria-label={t("highlight.bannerLabel")}
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
          {urgent ? <UrgentPill /> : <span className={styles.bannerTag}>{t("highlight.tag")}</span>}
          <span className={styles.bannerTitle}>{ad.title}</span>
          {meta && <span className={styles.bannerMeta}>{meta}</span>}
        </span>
      </span>
      {onAdPage ? (
        // Déjà sur la page : un lien vers la même route ne changerait le
        // fragment que par `pushState`, qui n'émet aucun événement — la modale
        // de lecture ne s'ouvrirait pas. L'ancre native, elle, déclenche bien
        // `hashchange`.
        <a href={`#${anchor}`} className={styles.bannerLink} aria-label={bannerLinkLabel(ad, text)}>
          {t("highlight.view")} <span aria-hidden="true">→</span>
        </a>
      ) : (
        <LocaleLink href={adHref(ad)} className={styles.bannerLink} aria-label={bannerLinkLabel(ad, text)}>
          {t("highlight.view")} <span aria-hidden="true">→</span>
        </LocaleLink>
      )}
      {multiple && (
        <span className={styles.bannerControls} data-tap-zone>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => step(-1)}
            aria-label={t("highlight.previous")}
          >
            ‹
          </button>
          <span className={styles.bannerCount}>
            <span aria-hidden="true">
              {position + 1}/{count}
            </span>
            <span className="sr-only">{t("highlight.position", { position: position + 1, count })}</span>
          </span>
          <button
            type="button"
            className={styles.bannerButton}
            onClick={() => step(1)}
            aria-label={t("highlight.next")}
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
              aria-label={paused ? t("highlight.resume") : t("highlight.pause")}
              title={paused ? t("highlight.resumeTitle") : t("highlight.pauseTitle")}
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
        aria-label={t("highlight.close")}
      >
        ✕
      </button>
    </section>
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
  keptIds,
  startIndex,
  signedIn,
  accountBackOn,
}: Readonly<{
  ads: readonly RecruitmentAd[];
  seenIds: readonly number[];
  keptIds: readonly number[];
  startIndex: number;
  signedIn: boolean;
  accountBackOn: boolean;
}>) {
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
  const seenValue = serializeRecruitmentSeen([...keptIds, ...ads.filter((a) => viewed.has(a.id)).map((a) => a.id)]);

  function go(direction: -1 | 1) {
    const next = (index + direction + ads.length) % ads.length;
    setIndex(next);
    setViewed((prev) => (prev.has(ads[next].id) ? prev : new Set([...prev, ads[next].id])));
  }

  function dismiss() {
    writeSeenCookie(RECRUITMENT_MODAL_COOKIE, seenValue, RECRUITMENT_MODAL_COOKIE_MAX_AGE);
    setOpen(false);
  }

  /**
   * « Ne plus afficher » : la modale ne s'ouvrira plus d'elle-même — sur ce
   * navigateur (cookie, lu par la mise en page racine) et, connecté, sur le
   * compte. Les annonces restent sur la page de recrutement et la banderole.
   * Le cookie est posé d'abord : un compte injoignable laisse au moins ce
   * navigateur tranquille, et le toast le dit.
   */
  async function optOut() {
    // Le cookie est posé dès l'appel, avant la fermeture.
    const saved = recordRecruitmentModalOptOut(signedIn, { accountCatchUp: !accountBackOn });
    dismiss();
    const { kind, key } = recruitmentOptOutToast(await saved);
    if (kind === "error") toast?.showError(t(`highlight.${key}`));
    else {
      toast?.showSuccess(t(`highlight.${key}`));
      // « Mon profil » ouvert sous la modale : sa case suit sans rechargement.
      window.dispatchEvent(new Event(RECRUITMENT_MODAL_OFF_EVENT));
    }
  }

  // Le hook doit être appelé à chaque rendu : il ne s'active que si `open`.
  const dialogRef = useDialogBehavior({ open, onClose: dismiss });
  const text = useRecruitmentText();
  const { t } = text;
  const backdrop = useBackdropDismiss(dismiss);
  const toast = useOptionalToast();

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
  const meta = adMeta(ad, text);
  const preview = buildRecruitmentPreview(ad.body, MODAL_PREVIEW_MAX);
  const applyHref = recruitmentContactHref(ad.contactUrl);
  const titleId = `recruitment-arrival-title-${ad.id}`;

  return (
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.modalOverlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.modalEyebrow}>
          <span className="eyebrow">{t("highlight.eyebrow")}</span>
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
              {t("highlight.previousPage")}
            </button>
            <span className={styles.pagerCount} aria-live="polite">
              <span aria-hidden="true">
                {position + 1} / {count}
              </span>
              <span className="sr-only">{t("highlight.position", { position: position + 1, count })}</span>
            </span>
            <button
              type="button"
              className={styles.pagerButton}
              onClick={() => go(1)}
            >
              {t("highlight.nextPage")}
            </button>
          </div>
        )}

        <div className={styles.modalActions}>
          <CyberButton variant="ghost" onClick={dismiss}>
            {t("highlight.later")}
          </CyberButton>
          {/* La lecture complète se fait toujours sur la page de recrutement :
              la modale d'accueil reste un teaser, jamais un pavé de 2 000 signes. */}
          <CyberButton variant={applyHref ? "ghost" : "primary"} asChild>
            <LocaleLink href={adHref(ad)} onClick={dismiss}>
              {t("highlight.read")}
            </LocaleLink>
          </CyberButton>
          {applyHref && (
            <CyberButton variant="primary" asChild>
              <a href={applyHref} target="_blank" rel="noopener noreferrer" onClick={dismiss}>
                {t("highlight.apply")}
              </a>
            </CyberButton>
          )}
        </div>
        {/* Secondaire, sous les actions et **après** elles dans l'ordre du
            focus : « Plus tard » reste le premier geste atteint (focus
            d'ouverture sans pager, première tabulation après le pager), et
            Entrée pour fermer ne coupe jamais la modale pour de bon. */}
        <div className={styles.optOutRow}>
          <button type="button" className={styles.optOut} onClick={() => void optOut()}>
            {t("highlight.dontShowAgain")}
          </button>
        </div>
      </div>
    </div>
  );
}
