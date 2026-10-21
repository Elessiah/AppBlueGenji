"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentType } from "react";
import { useShellText } from "@/components/i18n/shell-text";
import { orReload } from "@/lib/shared/lazy-component";
import { PRIVACY_CHANGES_ANSWERED_EVENT, privacyFollowedLink } from "@/lib/shared/privacy-changes";
import { TERMS_ACCEPTED_EVENT, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";
import { scopedText } from "@/lib/shared/scoped-text";
import type { Locale } from "@/lib/shared/locales";
import type { DiscordCertifyPromptProps, DiscordCertifyPromptViewProps } from "./DiscordCertifyPrompt";
import type { CertifyPromptMessages } from "./certify-prompt-text";

/** La fenêtre, liée aux textes d'une langue. */
function withText(
  View: ComponentType<DiscordCertifyPromptViewProps>,
  locale: Locale,
  messages: CertifyPromptMessages,
): ComponentType<DiscordCertifyPromptProps> {
  const text = scopedText(locale, messages);
  return function DiscordCertifyPromptIn(props: Readonly<DiscordCertifyPromptProps>) {
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
 * compte connecté (`docs/features/DISCORD_CERTIFY_PROMPT.md`) mais **chargée
 * seulement quand elle est due** : sans proposition, ni son code ni ses textes
 * ne partent, et une page n'en paie que ce petit relais.
 *
 * Retient ce qui arrive **avant** le morceau — une réponse à la
 * confidentialité (lien d'action compris : la page visée n'est pas couverte),
 * des conditions acceptées ou de nouveau exigées — sans quoi la fenêtre
 * attendrait jusqu'au prochain chargement complet.
 */
export function DiscordCertifyPromptLazy({ prompt, privacyPending, termsPending }: Readonly<DiscordCertifyPromptProps>) {
  const { locale } = useShellText();
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  const [followedLink, setFollowedLink] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const due = prompt !== null;

  // Une proposition qui apparaît (connexion par code, `router.refresh()`) repart de zéro.
  useEffect(() => {
    if (due) setFollowedLink(false);
  }, [due]);

  useEffect(() => {
    const onPrivacy = (event: Event) => {
      setPrivacyAnswered(true);
      if (privacyFollowedLink(event)) setFollowedLink(true);
    };
    const onTermsAccepted = () => setTermsAccepted(true);
    const onTermsRequired = () => setTermsAccepted(false);
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
    window.addEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
    window.addEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    return () => {
      window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
      window.removeEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    };
  }, []);

  if (!due || followedLink) return null;
  const View = locale === "en" ? DiscordCertifyPromptEn : DiscordCertifyPromptFr;
  return (
    <View
      prompt={prompt}
      privacyPending={privacyPending && !privacyAnswered}
      termsPending={termsAccepted === null ? termsPending : !termsAccepted}
    />
  );
}
