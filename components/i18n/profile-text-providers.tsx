"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import { onceLoader } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import type { ProfileEnglishMessages } from "./profile-english-messages";
import { ProfileTextProvider } from "./profile-text-provider";
import { TeamErrorsTextProvider } from "./team-errors-text-provider";

const englishLoader = onceLoader<ProfileEnglishMessages>(() =>
  import("./profile-english-messages").then((module) => module.PROFILE_ENGLISH_MESSAGES),
);

/**
 * Les fournisseurs de `/profil` (profil, refus d'équipe, notifications), posés
 * par sa mise en page — sans aucun français (déjà dans le paquet de la page).
 *
 * **L'anglais une seule fois** (revue de performance du lot 9-2) : la page
 * appelle `router.refresh()` après chaque enregistrement, avatar ou réponse à
 * une invitation, et une mise en page qui sérialise ~34 Ko d'anglais les
 * renverrait à chaque fois. La mise en page ne les sérialise donc qu'au
 * chargement **complet** d'une page (`messages`) ; une requête de navigation
 * ou de rafraîchissement n'en porte aucun. Ce que la page a reçu reste ici
 * (`onceLoader`, gardé pour la session) ; une arrivée par navigation, sans
 * rien reçu encore, charge l'anglais dans son propre morceau, `fallback`
 * (l'écran de chargement du segment) affiché d'ici là. Un échec retombe sur le
 * français plutôt que sur une page vide.
 */
export function ProfileTextProviders({
  locale,
  messages,
  fallback,
  children,
}: Readonly<{ locale: Locale; messages?: ProfileEnglishMessages; fallback: ReactNode; children: ReactNode }>) {
  if (locale === "en" && messages) englishLoader.prime(messages);
  const [english, setEnglish] = useState<ProfileEnglishMessages | null>(() => (locale === "en" ? englishLoader.loaded() : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (locale !== "en" || english) return;
    let live = true;
    englishLoader.load().then(
      (loaded) => {
        if (live) setEnglish(loaded);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [locale, english]);

  if (locale === "en" && !english && !failed) return <>{fallback}</>;
  const provided = locale === "en" ? (english ?? undefined) : undefined;
  return (
    <TeamErrorsTextProvider locale={locale} messages={provided?.teamErrors}>
      <ProfileTextProvider locale={locale} messages={provided?.profile}>
        <PushTextProvider locale={locale} messages={provided?.push}>
          {children}
        </PushTextProvider>
      </ProfileTextProvider>
    </TeamErrorsTextProvider>
  );
}
