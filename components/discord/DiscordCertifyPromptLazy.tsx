"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { certifyPromptOpen } from "@/lib/shared/global-modals";
import { DISCORD_CERTIFIED_EVENT } from "@/lib/shared/discord-certify-events";
import { orReload } from "@/lib/shared/lazy-component";
import { PRIVACY_CHANGES_ANSWERED_EVENT, privacyFollowedLink } from "@/lib/shared/privacy-changes";
import { TERMS_ACCEPTED_EVENT, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";
import { scopedText } from "@/lib/shared/scoped-text";
import type { Locale } from "@/lib/shared/locales";
import type { DiscordCertifyPromptProps, DiscordCertifyPromptViewProps } from "./DiscordCertifyPrompt";
import { answerCertifyPrompt, onCertifyPromptAnsweredElsewhere, recheckCertifyPrompt } from "./certify-prompt-answer";
import type { CertifyPromptMessages } from "./certify-prompt-text";

/** La fenêtre, liée aux textes d'une langue. */
function withText(
  View: ComponentType<DiscordCertifyPromptViewProps>,
  locale: Locale,
  messages: CertifyPromptMessages,
): ComponentType<Omit<DiscordCertifyPromptViewProps, "text">> {
  const text = scopedText(locale, messages);
  return function DiscordCertifyPromptIn(props: Readonly<Omit<DiscordCertifyPromptViewProps, "text">>) {
    return <View {...props} text={text} />;
  };
}

/*
 * Un morceau par langue (code commun partagé) : une page française ne
 * télécharge jamais l'anglais, ni l'inverse. Un morceau disparu (déploiement
 * entre la page et lui) recharge la page quand c'est sûr (`orReload`).
 */
const DiscordCertifyPromptFr = dynamic(
  () =>
    orReload(
      Promise.all([import("./DiscordCertifyPrompt"), import("@/messages/fr/certifyPrompt.json")]).then(([module, messages]) =>
        withText(module.DiscordCertifyPrompt, "fr", messages.default),
      ),
    ),
  { ssr: false },
);
const DiscordCertifyPromptEn = dynamic(
  () =>
    orReload(
      Promise.all([import("./DiscordCertifyPrompt"), import("@/messages/en/certifyPrompt.json")]).then(([module, messages]) =>
        withText(module.DiscordCertifyPrompt, "en", messages.default),
      ),
    ),
  { ssr: false },
);

/**
 * Absence d'onglet en deçà de laquelle une fenêtre affichée n'est pas relue au
 * retour : un aller-retour bref (vers le jeu, une autre fenêtre) ne coûte
 * aucune requête, et un choix fait dans ce navigateur arrive déjà par le canal.
 */
export const RECHECK_AFTER_HIDDEN_MS = 30_000;

/**
 * « Certifier ton tag Discord ? », montée par la mise en page racine pour tout
 * compte dont la proposition est due (`docs/features/DISCORD_CERTIFY_PROMPT.md`),
 * et **chargée seulement quand elle peut s'ouvrir** : ni son code ni ses textes
 * ne partent tant que la confidentialité ou les conditions attendent, ni sur
 * une page qui la tait ; une fois chargée, elle reste montée.
 *
 * Seul à suivre ce que la fenêtre attend — une réponse à la confidentialité
 * (lien d'action compris : la page visée n'est pas couverte, rien n'est écrit,
 * la proposition revient au chargement suivant), des conditions acceptées ou
 * de nouveau exigées, un tag certifié (avant son chargement comme après) — et à lui dire si
 * elle peut s'ouvrir (`canOpen`). Montée par la mise en page seulement quand
 * une proposition est due : une proposition qui réapparaît la remonte, neuve.
 *
 * **Jamais sur un état périmé** : la lecture de la mise en page ne vaut que
 * pour une fenêtre qui s'ouvre dès le chargement. Toute autre ouverture
 * (après la confidentialité ou les conditions, au retour d'une page qui la
 * tait) relit d'abord la proposition (`recheckCertifyPrompt`, fermée en cas de
 * doute ; le morceau se charge pendant ce temps) ; ouverte, elle se relit
 * quand l'onglet redevient visible après une absence (`RECHECK_AFTER_HIDDEN_MS`)
 * et ne se ferme alors que sur une réponse tranchée ; une réponse donnée dans
 * un autre onglet la ferme (`BroadcastChannel`). Un « Ne
 * plus voir » ou une certification faits sur un autre appareil ne la rouvrent
 * donc nulle part. Aucune requête tant qu'elle n'a pas à s'ouvrir.
 */
export function DiscordCertifyPromptLazy({ prompt, privacyPending, termsPending }: Readonly<DiscordCertifyPromptProps>) {
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  const [followedLink, setFollowedLink] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [certified, setCertified] = useState(false);
  const [armed, setArmed] = useState(false);
  /** Parcours offert : celui de la mise en page (relu à chaque rendu serveur), puis celui de la dernière relecture. */
  const [current, setCurrent] = useState(prompt);
  const [layoutPrompt, setLayoutPrompt] = useState(prompt);
  if (prompt !== layoutPrompt) {
    setLayoutPrompt(prompt);
    setCurrent(prompt);
  }
  /** Plus due (relecture, ou réponse donnée dans un autre onglet) : rien ne s'ouvre plus sur ce chargement. */
  const [revoked, setRevoked] = useState(false);
  /** Déjà répondue sur ce chargement (fenêtre ou certification) : un seul `LATER`. */
  const answered = useRef(false);
  const { locale, path: pathname } = useLocalePathname();

  const canOpen =
    !followedLink &&
    !certified &&
    certifyPromptOpen({
      due: true,
      privacyPending: privacyPending && !privacyAnswered,
      termsPending: termsAccepted === null ? termsPending : !termsAccepted,
      pathname,
    });
  /**
   * La proposition est-elle confirmée pour l'ouverture en cours ? D'emblée
   * pour une fenêtre qui s'ouvre au chargement (lecture de la mise en page,
   * fraîche) ; perdu dès qu'elle ne peut plus s'ouvrir, et regagné par une
   * relecture.
   */
  const [confirmed, setConfirmed] = useState(canOpen);
  if (!canOpen && confirmed) setConfirmed(false);

  useEffect(() => {
    const onPrivacy = (event: Event) => {
      setPrivacyAnswered(true);
      if (privacyFollowedLink(event)) setFollowedLink(true);
    };
    const onTermsAccepted = () => setTermsAccepted(true);
    const onTermsRequired = () => setTermsAccepted(false);
    // Certifié — d'un clic dans la fenêtre, ou par le dialogue de `/profil`,
    // fenêtre chargée ou non (conditions encore à accepter, morceau en route) :
    // close pour la session, qu'elle ne s'ouvre pas pour un tag déjà certifié.
    const onCertified = () => {
      setCertified(true);
      if (answered.current) return;
      answered.current = true;
      answerCertifyPrompt("LATER").catch(() => undefined);
    };
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
    window.addEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
    window.addEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
    return () => {
      window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
      window.removeEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
      window.removeEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
    };
  }, []);

  const over = certified || followedLink || revoked;
  // Canal ouvert tant que la proposition peut encore s'afficher ici, fermé ensuite.
  useEffect(() => {
    if (over) return;
    return onCertifyPromptAnsweredElsewhere(() => {
      answered.current = true;
      setRevoked(true);
    });
  }, [over]);

  // Ouverture plus tard que le chargement : relire avant, fermée en cas de doute.
  useEffect(() => {
    if (!canOpen || confirmed || revoked || answered.current) return;
    const abort = new AbortController();
    recheckCertifyPrompt(abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (result !== "UNKNOWN" && result.prompt) {
        setCurrent(result.prompt);
        setConfirmed(true);
      } else {
        setRevoked(true);
      }
    });
    return () => abort.abort();
  }, [canOpen, confirmed, revoked]);

  const shown = canOpen && confirmed && !revoked;
  // Affichée dans un onglet laissé un moment en arrière-plan (ou rendue par le
  // cache avant/arrière) : relue au retour, que le choix fait ailleurs
  // entre-temps la ferme. Seule une réponse tranchée la ferme : un réseau pas
  // encore revenu (téléphone déverrouillé) ne l'escamote pas sous les yeux.
  useEffect(() => {
    if (!shown) return;
    let abort: AbortController | null = null;
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
    const check = () => {
      if (abort || answered.current) return;
      const request = new AbortController();
      abort = request;
      recheckCertifyPrompt(request.signal)
        .then((result) => {
          if (request.signal.aborted || result === "UNKNOWN" || answered.current) return;
          if (result.prompt) setCurrent(result.prompt);
          else setRevoked(true);
        })
        .finally(() => {
          if (abort === request) abort = null;
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt ??= Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= RECHECK_AFTER_HIDDEN_MS) check();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      abort?.abort();
    };
  }, [shown]);

  // Le morceau part dès que la fenêtre peut s'ouvrir — pendant la relecture
  // s'il y en a une —, puis reste (verrou posé au rendu).
  if (canOpen && !over && !armed) setArmed(true);

  if (over || !armed) return null;
  const View = locale === "en" ? DiscordCertifyPromptEn : DiscordCertifyPromptFr;
  return <View prompt={current} canOpen={shown} onProfile={pathname === "/profil"} answered={answered} />;
}
