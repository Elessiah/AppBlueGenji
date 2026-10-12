"use client";

import type { ReactNode } from "react";
import { PushTextProvider } from "@/components/notifications/push-text-provider";
import type { Locale } from "@/lib/shared/locales";
import { englishProfile, englishPush, englishTeamErrors } from "./english-loaders-account";
import type { ProfileEnglishMessages } from "./profile-english";
import { ProfileTextProvider } from "./profile-text-provider";
import { TeamErrorsTextProvider } from "./team-errors-text-provider";
import { usePathname } from "next/navigation";
import { useEnglishMessagesAt } from "./use-english-messages";
import { EnglishGateFallback } from "./english-gate-fallback";

/**
 * Les fournisseurs de `/profil` (profil, refus d'équipe, notifications), posés
 * par sa mise en page — sans aucun français (déjà dans le paquet de la page).
 *
 * **L'anglais une seule fois** (revue de performance du lot 9-2) : la mise en
 * page ne le sérialise qu'au chargement complet ; sinon chacun des trois
 * espaces est repris de la session ou chargé à part, **en parallèle et chacun
 * pour soi** — un espace qui échoue retombe seul sur le français, les autres
 * restent en anglais. L'écran d'attente (`EnglishGateFallback`) le temps
 * qu'ils arrivent.
 */
export function ProfileTextProviders({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: ProfileEnglishMessages; children: ReactNode }>) {
  // Le chemin lu une fois pour les trois espaces.
  const pathname = usePathname();
  const profile = useEnglishMessagesAt(locale, englishProfile, messages?.profile, pathname);
  const teamErrors = useEnglishMessagesAt(locale, englishTeamErrors, messages?.teamErrors, pathname);
  const push = useEnglishMessagesAt(locale, englishPush, messages?.push, pathname);
  if (profile.waiting || teamErrors.waiting || push.waiting) return <EnglishGateFallback />;
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
