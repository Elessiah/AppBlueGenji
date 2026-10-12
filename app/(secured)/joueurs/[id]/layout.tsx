import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getPlayerPageIdentity } from "@/lib/server/users/full-profile";
import { parseEntityPageId, playerPageTitle } from "@/lib/shared/entity-page-titles";
import { memberAreaShareMetadata } from "@/lib/shared/page-metadata";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { statsPanelMessages } from "@/lib/shared/stats-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { StatsPanelI18nProvider } from "@/components/i18n/stats-panel-i18n";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Le titre de la fiche d'un joueur (WCAG 2.4.2) : son pseudo, et non
 * « Joueurs », hérité de l'annuaire — deux onglets sur deux joueurs portaient
 * le même.
 *
 * Même mécanique que la fiche d'équipe (`app/(secured)/equipes/[id]/layout.tsx`) :
 * un titre et rien d'autre, lu pour un lecteur connecté seulement — la fiche est
 * refusée aux autres, l'onglet ne doit pas nommer quelqu'un que la page tait —,
 * et un compte anonymisé s'annonce « Compte supprimé » plutôt que par son pseudo
 * d'emprunt (`playerPageTitle`).
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).players;
  const words = { fallback: meta.fallbackTitle, deleted: meta.deletedTitle };
  const userId = parseEntityPageId(id);
  if (userId === null) return { title: playerPageTitle(null, words), ...memberAreaShareMetadata("player", "player", locale) };

  const player = await getCurrentUser()
    .then((user) => (user ? getPlayerPageIdentity(userId) : null))
    .catch(() => null);

  // Canonique et `hreflang` de **cette** fiche, dans la langue de l'adresse (lot 9).
  const path = `/joueurs/${userId}`;
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    title: playerPageTitle(player, words),
    alternates: languages ? { canonical, languages } : { canonical },
    ...memberAreaShareMetadata("player", "player", locale),
  };
}

/**
 * Pose les textes du bloc de statistiques : l'anglais sous `/en` seulement
 * (lot 9). Ceux de la fiche viennent de la mise en page de l'annuaire.
 */
export default async function PlayerDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const stats = locale === "en" ? { locale, messages: statsPanelMessages(messagesFor(locale)) } : undefined;
  return <StatsPanelI18nProvider value={stats}>{children}</StatsPanelI18nProvider>;
}
