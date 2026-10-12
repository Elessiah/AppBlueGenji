"use client";

import type { ReactNode } from "react";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import type { Locale } from "@/lib/shared/locales";
import { englishProfile, englishPush, englishTeamErrors } from "./english-loaders-account";
import type { ProfileEnglishMessages } from "./profile-english";
import { ProfileTextProvider } from "./profile-text-provider";
import { TeamErrorsTextProvider } from "./team-errors-text-provider";
import { useEnglishMessages } from "./use-english-messages";

/**
 * Les fournisseurs de `/profil` (profil, refus d'équipe, notifications), posés
 * par sa mise en page — sans aucun français (déjà dans le paquet de la page).
 *
 * **L'anglais une seule fois** (revue de performance du lot 9-2) : la mise en
 * page ne le sérialise qu'au chargement complet ; sinon chacun des trois
 * espaces est repris de la session ou chargé à part, **en parallèle et chacun
 * pour soi** — un espace qui échoue retombe seul sur le français, les autres
 * restent en anglais. `fallback` (l'écran de chargement du segment) le temps
 * qu'ils arrivent.
 */
export function ProfileTextProviders({
  locale,
  messages,
  fallback,
  children,
}: Readonly<{ locale: Locale; messages?: ProfileEnglishMessages; fallback: ReactNode; children: ReactNode }>) {
  const profile = useEnglishMessages(locale, englishProfile, messages?.profile);
  const teamErrors = useEnglishMessages(locale, englishTeamErrors, messages?.teamErrors);
  const push = useEnglishMessages(locale, englishPush, messages?.push);
  const waiting = (state: { english: unknown; failed: boolean }) => !state.english && !state.failed;
  if (locale === "en" && (waiting(profile) || waiting(teamErrors) || waiting(push))) return <>{fallback}</>;
  return (
    <TeamErrorsTextProvider locale={locale} messages={teamErrors.english ?? undefined}>
      <ProfileTextProvider locale={locale} messages={profile.english ?? undefined}>
        <PushTextProvider locale={locale} messages={push.english ?? undefined}>
          {children}
        </PushTextProvider>
      </ProfileTextProvider>
    </TeamErrorsTextProvider>
  );
}
