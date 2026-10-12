"use client";

import type { ReactNode } from "react";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import type { Locale } from "@/lib/shared/locales";
import { englishProfileMessages, useEnglishMessages, type ProfileEnglishMessages } from "./english-loaders";
import { ProfileTextProvider } from "./profile-text-provider";
import { TeamErrorsTextProvider } from "./team-errors-text-provider";

/**
 * Les fournisseurs de `/profil` (profil, refus d'équipe, notifications), posés
 * par sa mise en page — sans aucun français (déjà dans le paquet de la page).
 *
 * **L'anglais une seule fois** (revue de performance du lot 9-2) : la page
 * appelle `router.refresh()` après chaque enregistrement, avatar ou réponse à
 * une invitation, et une mise en page qui sérialise ~34 Ko d'anglais les
 * renverrait à chaque fois. La mise en page ne les sérialise donc qu'au
 * chargement **complet** d'une page (`messages`) ; une requête de navigation
 * ou de rafraîchissement n'en porte aucun. Ce que la session a reçu reste
 * (`english-loaders.ts`, un chargeur par espace : ce qu'une autre page a déjà
 * reçu ne repart pas) ; une arrivée par navigation charge le reste à part,
 * `fallback` (l'écran de chargement du segment) affiché d'ici là. Un échec
 * retombe sur le français plutôt que sur une page vide.
 */
export function ProfileTextProviders({
  locale,
  messages,
  fallback,
  children,
}: Readonly<{ locale: Locale; messages?: ProfileEnglishMessages; fallback: ReactNode; children: ReactNode }>) {
  const { english, failed } = useEnglishMessages(locale, englishProfileMessages, messages);
  if (locale === "en" && !english && !failed) return <>{fallback}</>;
  return (
    <TeamErrorsTextProvider locale={locale} messages={english?.teamErrors}>
      <ProfileTextProvider locale={locale} messages={english?.profile}>
        <PushTextProvider locale={locale} messages={english?.push}>
          {children}
        </PushTextProvider>
      </ProfileTextProvider>
    </TeamErrorsTextProvider>
  );
}
