import type { Metadata } from "next";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import type { GetiCategory } from "@/lib/shared/geti";
import { GETI_ROBOTS, getiCategoryPath } from "@/lib/shared/geti/page";
import { getiText } from "@/lib/shared/geti/page-text";
import { pageMetadata } from "@/lib/shared/page-metadata";

/**
 * Métadonnées d'une catégorie d'annonces, dans la langue de l'adresse. L'URL
 * canonique est toujours celle de la catégorie, **sans** filtres. La page
 * n'est pas indexée ({@link GETI_ROBOTS}).
 */
export async function getiCategoryMetadata(category: GetiCategory): Promise<Metadata> {
  const locale = await requestLocale();
  const m = messagesFor(locale).geti;
  const base = pageMetadata({
    title: getiText(locale, m.meta.categoryTitle, { category: m.categories[category].title }),
    description: m.meta.description,
    shareDescription: m.meta.shareDescription,
    path: getiCategoryPath(category),
    locale,
  });
  return { ...base, robots: GETI_ROBOTS };
}
