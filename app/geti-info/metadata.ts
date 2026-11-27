import type { Metadata } from "next";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import type { GetiCategory } from "@/lib/shared/geti";
import { getiCategoryPath } from "@/lib/shared/geti/page";
import { getiText } from "@/lib/shared/geti/page-text";
import { pageMetadata } from "@/lib/shared/page-metadata";

/**
 * Métadonnées d'une catégorie d'annonces, dans la langue de l'adresse. L'URL
 * canonique est toujours celle de la catégorie, **sans** filtres : une
 * recherche partagée n'est pas une page de plus pour un moteur.
 */
export async function getiCategoryMetadata(category: GetiCategory): Promise<Metadata> {
  const locale = await requestLocale();
  const m = messagesFor(locale).geti;
  return pageMetadata({
    title: getiText(locale, m.meta.categoryTitle, { category: m.categories[category].title }),
    description: m.meta.description,
    shareDescription: m.meta.shareDescription,
    path: getiCategoryPath(category),
    locale,
  });
}
