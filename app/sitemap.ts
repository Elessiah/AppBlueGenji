import type { MetadataRoute } from "next";
import { BOT_DOC_SECTIONS } from "@/lib/server/bot-docs";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { publicSitemapRoutes } from "@/lib/shared/sitemap";

/**
 * `sitemap.xml`, qui n'existait pas non plus — la route répondait `404`.
 *
 * Il ne liste que la vitrine : le choix de ce qui entre — et surtout de ce qui
 * n'entre pas — est documenté dans `lib/shared/sitemap.ts`, qui le tient. Cette
 * route ne fait que rendre les chemins absolus, un sitemap n'acceptant pas
 * autre chose.
 *
 * **Rendu à la demande, et pas à la compilation.** Next prérend volontiers ce
 * fichier, ce qui figerait l'adresse du site dans le paquet : une compilation
 * lancée sans `APP_URL` publierait alors un sitemap entier en
 * `http://localhost:3000` — un moteur le rejetterait en bloc, et rien sur le
 * site ne le laisserait voir. La route est minuscule, le rendre à chaque
 * requête ne coûte rien.
 *
 * **Aucune date de dernière modification**, et c'est un choix : les textes de la
 * vitrine s'éditent en base sans horodatage par page, il n'existe donc aucune
 * date juste à annoncer. Écrire l'instant du rendu annoncerait que tout le site
 * change à chaque visite — un moteur qui s'en aperçoit cesse d'y croire, y
 * compris le jour où la date serait vraie.
 */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteCanonicalBase();

  return publicSitemapRoutes(BOT_DOC_SECTIONS.map((section) => section.slug)).map((route) => ({
    url: `${base}${route.path === "/" ? "" : route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
