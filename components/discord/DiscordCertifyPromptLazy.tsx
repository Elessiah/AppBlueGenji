"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useLocalePathname } from "@/components/i18n/locale-navigation";
import { certifyPromptOpen } from "@/lib/shared/global-modals";
import { DISCORD_CERTIFIED_EVENT } from "@/lib/shared/discord-certify-events";
import { orReload } from "@/lib/shared/lazy-component";
import { PRIVACY_CHANGES_ANSWERED_EVENT, privacyFollowedLink } from "@/lib/shared/privacy-changes";
import { TERMS_ACCEPTED_EVENT, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";
import { scopedText } from "@/lib/shared/scoped-text";
import type { Locale } from "@/lib/shared/locales";
import type { DiscordCertifyPromptProps } from "./DiscordCertifyPrompt";
import type { DiscordCertifyPromptGateProps } from "./DiscordCertifyPromptGate";
import type { CertifyPromptMessages } from "./certify-prompt-text";

type GateProps = Omit<DiscordCertifyPromptGateProps, "text">;

/** La fenêtre (et sa garde), liée aux textes d'une langue. */
function withText(
  Gate: ComponentType<DiscordCertifyPromptGateProps>,
  locale: Locale,
  messages: CertifyPromptMessages,
): ComponentType<GateProps> {
  const text = scopedText(locale, messages);
  return function DiscordCertifyPromptIn(props: Readonly<GateProps>) {
    return <Gate {...props} text={text} />;
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
      Promise.all([import("./DiscordCertifyPromptGate"), import("@/messages/fr/certifyPrompt.json")]).then(([module, messages]) =>
        withText(module.DiscordCertifyPromptGate, "fr", messages.default),
      ),
    ),
  { ssr: false },
);
const DiscordCertifyPromptEn = dynamic(
  () =>
    orReload(
      Promise.all([import("./DiscordCertifyPromptGate"), import("@/messages/en/certifyPrompt.json")]).then(([module, messages]) =>
        withText(module.DiscordCertifyPromptGate, "en", messages.default),
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
 * La garde contre un état périmé (relecture, autres onglets) vit dans le
 * morceau (`DiscordCertifyPromptGate`) : ce relais, sur chaque page, reste léger.
 */
export function DiscordCertifyPromptLazy({ prompt, privacyPending, termsPending }: Readonly<DiscordCertifyPromptProps>) {
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  const [followedLink, setFollowedLink] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [certified, setCertified] = useState(false);
  const [armed, setArmed] = useState(false);
  /** Répondue sur ce chargement, ici ou dans un autre onglet : le morceau se démonte. */
  const [done, setDone] = useState(false);
  /** Même fait, lu sans attendre un rendu : un seul `LATER`. */
  const answered = useRef(false);
  /** Lecture de la mise en page : celle du chargement de ce relais. */
  const [loadedAt] = useState(() => Date.now());
  const { locale, path: pathname } = useLocalePathname();

  const markAnswered = useCallback(() => {
    answered.current = true;
    setDone(true);
  }, []);

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
    // Écriture chargée à la demande (rare) : rien de plus sur chaque page.
    const onCertified = () => {
      setCertified(true);
      if (answered.current) return;
      markAnswered();
      import("./certify-prompt-answer")
        .then(({ answerCertifyPrompt }) => answerCertifyPrompt("LATER"))
        .catch(() => undefined);
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
  }, [markAnswered]);

  const over = certified || followedLink || done;
  const canOpen =
    !over &&
    certifyPromptOpen({
      due: true,
      privacyPending: privacyPending && !privacyAnswered,
      termsPending: termsAccepted === null ? termsPending : !termsAccepted,
      pathname,
    });
  // Le morceau part dès que la fenêtre peut s'ouvrir, puis reste (verrou posé au rendu).
  if (canOpen && !armed) setArmed(true);

  if (over || !armed) return null;
  const Gate = locale === "en" ? DiscordCertifyPromptEn : DiscordCertifyPromptFr;
  return (
    <Gate
      prompt={prompt}
      canOpen={canOpen}
      onProfile={pathname === "/profil"}
      answered={answered}
      onAnswered={markAnswered}
      loadedAt={loadedAt}
    />
  );
}
