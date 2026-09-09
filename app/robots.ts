import type { MetadataRoute } from "next";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { SITEMAP_DISALLOWED_PATHS } from "@/lib/shared/sitemap";

/**
 * `robots.txt`, qui n'existait pas — la route répondait `404` en production.
 *
 * Son rôle ici n'est pas d'interdire mais de **désigner le sitemap** : sans lui,
 * un moteur qui arrive sur le site n'a aucun moyen d'apprendre la liste des
 * pages autrement qu'en suivant des liens. Ce qui doit rester hors de l'index
 * l'annonce lui-même par un `noindex` — voir la note de
 * `lib/shared/sitemap.ts` sur la raison de ne *pas* les interdire ici.
 */
/**
 * Rendu à la demande, pour la même raison que le sitemap : préremplie à la
 * compilation, l'adresse du site y serait figée, et un `robots.txt` qui désigne
 * un sitemap sur `localhost` ne désigne rien.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = siteCanonicalBase();

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...SITEMAP_DISALLOWED_PATHS] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
