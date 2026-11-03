import type { Metadata } from "next";
import { memberAreaShareMetadata, segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

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
 * Aucun texte client ici : chaque écran pose les siens — la liste par sa page
 * (`page.tsx`), la fiche par sa mise en page (`TournamentSheetTextGate`, qui
 * porte aussi les textes communs avec la liste), la création et l'édition par
 * leurs mises en page. Un fournisseur à ce niveau renverrait ses textes
 * anglais à chaque `router.refresh()` de la fiche.
 */
export default function TournamentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
