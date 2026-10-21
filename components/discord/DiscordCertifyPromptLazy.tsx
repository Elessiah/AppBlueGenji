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
 * doute) ; ouverte, elle se relit quand l'onglet redevient visible ; une
 * réponse donnée dans un autre onglet la ferme (`BroadcastChannel`). Un « Ne
 * plus voir » ou une certification faits sur un autre appareil ne la rouvrent
 * donc nulle part. Aucune requête tant qu'elle n'a pas à s'ouvrir.
 */
export function DiscordCertifyPromptLazy({ prompt, privacyPending, termsPending }: Readonly<DiscordCertifyPromptProps>) {
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  const [followedLink, setFollowedLink] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [certified, setCertified] = useState(false);
  const [armed, setArmed] = useState(false);
  /** Parcours offert : celui de la mise en page, puis celui de la dernière relecture. */
  const [current, setCurrent] = useState(prompt);
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
    // Répondue dans un autre onglet (même session) : déjà écrite là-bas.
    const onElsewhere = () => {
      answered.current = true;
      setRevoked(true);
    };
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
    window.addEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
    window.addEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
    const stopElsewhere = onCertifyPromptAnsweredElsewhere(onElsewhere);
    return () => {
      window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
      window.removeEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
      window.removeEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
      stopElsewhere();
    };
  }, []);

  // Ouverture plus tard que le chargement : relire avant, fermée en cas de doute.
  useEffect(() => {
    if (!canOpen || confirmed || revoked || answered.current) return;
    let live = true;
    recheckCertifyPrompt().then((next) => {
      if (!live) return;
      if (next) {
        setCurrent(next);
        setConfirmed(true);
      } else {
        setRevoked(true);
      }
    });
    return () => {
      live = false;
    };
  }, [canOpen, confirmed, revoked]);

  const shown = canOpen && confirmed && !revoked;
  // Affichée dans un onglet laissé en arrière-plan (ou rendu par le cache
  // avant/arrière) : relue au retour, que le choix fait ailleurs entre-temps la ferme.
  useEffect(() => {
    if (!shown) return;
    let inFlight = false;
    const check = () => {
      if (inFlight || answered.current || document.visibilityState !== "visible") return;
      inFlight = true;
      recheckCertifyPrompt()
        .then((next) => {
          if (!next && !answered.current) setRevoked(true);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) check();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [shown]);

  // Le morceau ne part qu'au moment où la fenêtre peut s'ouvrir, puis reste
  // (verrou posé au rendu : aucun second passage après l'ouverture).
  if (shown && !armed) setArmed(true);

  if (certified || followedLink || revoked || !armed) return null;
  const View = locale === "en" ? DiscordCertifyPromptEn : DiscordCertifyPromptFr;
  return <View prompt={current} canOpen={shown} onProfile={pathname === "/profil"} answered={answered} />;
}
