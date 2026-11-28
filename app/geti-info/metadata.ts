import type { Metadata } from "next";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import type { GetiCategory } from "@/lib/shared/geti";
import { GETI_ROBOTS, getiCategoryPath } from "@/lib/shared/geti/page";
import { getiText } from "@/lib/shared/geti/page-text";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { getiShareCardKey } from "@/lib/shared/page-share-cards";

/**
 * Métadonnées d'une catégorie d'annonces, dans la langue de l'adresse. L'URL
 * canonique est toujours celle de la catégorie, **sans** filtres. La page
 * n'est pas indexée ({@link GETI_ROBOTS}) — ce qui n'empêche pas l'aperçu d'un
 * lien collé : titre, phrase et carte (`/og/<langue>/geti-<catégorie>.png`)
 * sont propres à la catégorie (`docs/features/GETI_INFO.md` § Aperçu).
 */
export async function getiCategoryMetadata(category: GetiCategory): Promise<Metadata> {
  const locale = await requestLocale();
  const m = messagesFor(locale).geti;
  const base = pageMetadata({
    title: getiText(locale, m.meta.categoryTitle, { category: m.categories[category].title }),
    description: m.meta.description,
    // L'encart d'un lien collé (Discord) dit ce que **cette** liste contient.
    shareDescription: m.categories[category].lede,
    path: getiCategoryPath(category),
    locale,
    shareCard: getiShareCardKey(category),
  });
  return { ...base, robots: GETI_ROBOTS };
}
