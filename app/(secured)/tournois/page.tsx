import type { Metadata } from "next";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { TournamentsListTextGate } from "@/components/i18n/tournaments-list-text-gate";
import { englishOnDocumentLoad } from "@/lib/server/layout-messages";
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

/**
 * Le droit staff (`tournaments`) se lit ici, sur le serveur, où la mise en page
 * de l'espace sécurisé l'a déjà résolu (`getCurrentUser` est mémoïsé par
 * requête) : le client n'a plus à le redemander (`/api/auth/me`), et « Créer »
 * comme la section des invisibles sont là dès le premier rendu.
 */
export default async function TournamentsPage() {
  const [user, locale] = await Promise.all([getCurrentUser(), requestLocale()]);
  // Les espaces de la liste, de ses cartes et du bandeau, sous `/en` et au
  // chargement complet seulement (revue de performance du lot 9-2) : une
  // navigation ou un `router.refresh()` les charge par leur morceau.
  const messages = await englishOnDocumentLoad(locale, tournamentsClientMessages);
  return (
    <TournamentsListTextGate locale={locale} messages={messages}>
      <TournamentsList canManage={can(user, "tournaments")} />
    </TournamentsListTextGate>
  );
}
