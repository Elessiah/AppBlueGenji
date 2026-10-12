import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { ProfileTextProvider } from "@/components/i18n/profile-text";
import { TeamErrorsTextProvider } from "@/components/i18n/team-errors-text";

/**
 * Titre de l'écran « Mon profil » — voir `app/(secured)/tournois/layout.tsx`
 * pour la raison d'une mise en page —, dans la langue de l'adresse (lot 9-2),
 * avec canonique et `hreflang` (la page n'a pas de sous-page).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const path = "/profil";
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    title: segmentTitle(messagesFor(locale).profile.meta.title),
    alternates: languages ? { canonical, languages } : { canonical },
  };
}

/**
 * Pose les textes du profil et la table des refus d'équipe (réponses aux
 * invitations, refus d'une image) : rien en français, déjà dans le paquet ;
 * l'anglais sous `/en` seulement.
 */
export default async function ProfileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const messages = locale === "en" ? messagesFor(locale) : undefined;
  return (
    <TeamErrorsTextProvider locale={locale} messages={messages?.teamErrors}>
      <ProfileTextProvider locale={locale} messages={messages?.profile}>
        {children}
      </ProfileTextProvider>
    </TeamErrorsTextProvider>
  );
}
