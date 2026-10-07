import type { Metadata } from "next";
import { memberAreaShareMetadata, segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";

/**
 * Le titre du segment (WCAG 2.4.2) et l'encart générique des tournois.
 *
 * Un titre et un encart, et **rien d'autre** : pas de `pageMetadata()`. Une
 * mise en page transmet ses métadonnées à tout le segment, et l'URL canonique
 * comme l'`og:url` de la liste seraient descendues sur chaque fiche — un lien
 * vers `/equipes/12` se serait annoncé comme `/equipes`. Canonique et
 * `hreflang` de la liste sont posés par sa page (`page.tsx`) ; la fiche d'un
 * tournoi pose son titre. Le titre passe par `segmentTitle()`, sans quoi les
 * sous-pages perdraient le nom du site.
 *
 * Encart générique (`memberAreaShareMetadata`) : le robot d'aperçu n'a pas de
 * session — ni nom ni pseudo, rien que le `<head>` anonyme ne montre déjà. Il
 * suit la langue de l'adresse (`/en/tournois`, lot 8a).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).tournaments;
  return { title: segmentTitle(meta.title), ...memberAreaShareMetadata("tournaments", "tournaments", locale) };
}

/**
 * Pose les textes client des tournois : rien en français (déjà dans le
 * paquet), les espaces client de l'anglais sous `/en` seulement.
 */
export default async function TournamentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const messages = locale === "en" ? tournamentsClientMessages(messagesFor(locale)) : undefined;
  return (
    <TournamentsTextProvider locale={locale} messages={messages}>
      {children}
    </TournamentsTextProvider>
  );
}
