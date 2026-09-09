import type { MetadataRoute } from "next";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { SITEMAP_ALLOWED_PATHS, SITEMAP_DISALLOWED_PATHS } from "@/lib/shared/sitemap";

/**
 * `robots.txt`, qui n'existait pas — la route répondait `404` en production.
 *
 * Son rôle ici n'est pas d'interdire mais de **désigner le sitemap** : sans lui,
 * un moteur qui arrive sur le site n'a aucun moyen d'apprendre la liste des
 * pages autrement qu'en suivant des liens. Ce qui doit rester hors de l'index
 * l'annonce lui-même par un `noindex` — voir la note de
 * `lib/shared/sitemap.ts` sur la raison de ne *pas* les interdire ici.
 *
 * **Rendu à la demande, et pas à la compilation** (`dynamic`, ci-dessous), pour
 * la même raison que le sitemap : préremplie, l'adresse du site y serait figée,
 * et un `robots.txt` qui désigne un sitemap sur `localhost` ne désigne rien.
 *
 * Le fichier ne porte que les deux directives que les moteurs lisent
 * réellement. Pas de `Host:` en particulier : c'est une extension Yandex
 * abandonnée depuis 2018, qu'aucun moteur majeur ne lit et dont la forme
 * attendue est un nom d'hôte — l'écrire avec un schéma ajouterait une ligne
 * qu'un outil d'audit signalerait sans qu'elle serve à personne.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [...SITEMAP_ALLOWED_PATHS],
        disallow: [...SITEMAP_DISALLOWED_PATHS],
      },
    ],
    sitemap: `${siteCanonicalBase()}/sitemap.xml`,
  };
}
