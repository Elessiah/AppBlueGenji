import type { Metadata } from "next";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import TournamentsList from "./TournamentsList";

/**
 * `/tournois` et `/en/tournois` (lot 8a) : la page reste cliente
 * (`TournamentsList`) ; cette enveloppe serveur ne fait que déclarer ses
 * métadonnées dans la langue de l'adresse — titre, canonique et `hreflang`
 * réciproques. L'encart de partage reste celui de la mise en page (carte
 * générique de l'espace membre, dans la même langue). `noindex` vient de la
 * mise en page de l'espace sécurisé, et la page reste hors sitemap
 * (`lib/shared/sitemap.ts`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).tournaments;
  const path = "/tournois";
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: languages ? { canonical, languages } : { canonical },
  };
}

export default function TournamentsPage() {
  return <TournamentsList />;
}
