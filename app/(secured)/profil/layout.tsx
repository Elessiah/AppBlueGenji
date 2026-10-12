import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { DOCUMENT_REQUEST_HEADER, localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { headers } from "next/headers";
import { ProfileTextProviders } from "@/components/i18n/profile-text-providers";
import { SecuredLoadingView } from "../_shared/SecuredLoading";

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
 * Pose les textes du profil, ceux du réglage des notifications et la table des
 * refus d'équipe (réponses aux invitations, refus d'une image) : rien en
 * français, déjà dans le paquet ; l'anglais sous `/en` seulement, et au
 * chargement complet d'une page seulement — une requête de navigation ou de
 * `router.refresh()` (`DOCUMENT_REQUEST_HEADER`, posé par le middleware) n'en porte aucun : le client garde celui
 * qu'il a reçu, ou le charge à part (`ProfileTextProviders`).
 */
export default async function ProfileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const documentRequest = (await headers()).get(DOCUMENT_REQUEST_HEADER) !== "0";
  const all = messagesFor(locale);
  const messages = locale === "en" && documentRequest ? { profile: all.profile, teamErrors: all.teamErrors, push: all.push } : undefined;
  return (
    <ProfileTextProviders locale={locale} messages={messages} fallback={<SecuredLoadingView label={all.shell.loading} />}>
      {children}
    </ProfileTextProviders>
  );
}
