import { headers } from "next/headers";
import { LOCALE_HEADER, localeFromHeader, type Locale } from "@/lib/shared/locales";

/**
 * La langue de la requête en cours, posée par le middleware (`x-bg-locale`)
 * d'après l'URL — `fr` à défaut.
 *
 * `headers()` est déjà lu par la mise en page racine (nonce CSP) : tout le site
 * est rendu dynamiquement, cette lecture ne coûte aucun rendu statique.
 */
export async function requestLocale(): Promise<Locale> {
  return localeFromHeader((await headers()).get(LOCALE_HEADER));
}
