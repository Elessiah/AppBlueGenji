import type { Metadata } from "next";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import PlayersList from "./PlayersList";

/**
 * `/joueurs` et `/en/joueurs` (lot 9) : la page reste cliente (`PlayersList`) ;
 * cette enveloppe serveur déclare ses métadonnées dans la langue de l'adresse —
 * titre, canonique et `hreflang` réciproques. Les textes viennent de la mise
 * en page du segment. `noindex` et hors sitemap, comme avant.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).players;
  const path = "/joueurs";
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: languages ? { canonical, languages } : { canonical },
  };
}

export default function PlayersPage() {
  return <PlayersList />;
}
