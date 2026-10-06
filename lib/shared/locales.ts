/**
 * Langues du site et adresses par langue (`docs/features/I18N.md`).
 *
 * **L'URL est la seule source de vérité de la langue** : le français est servi
 * sans préfixe (`/regles`), l'anglais sous `/en` (`/en/regles`). Ni cookie ni
 * `Accept-Language` : un robot doit voir les deux versions, et une adresse
 * partagée doit s'ouvrir dans la langue où on l'a lue.
 *
 * Module pur, importable partout — middleware (Edge) compris.
 */
import { MIGRATED_ROUTES } from "./i18n-routes";

export const LOCALES = ["fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Langue des adresses sans préfixe, et repli de toute valeur inconnue. */
export const DEFAULT_LOCALE: Locale = "fr";

/**
 * En-tête de **requête** par lequel le middleware remet la langue au rendu.
 * Celui d'un client est remplacé sur toute requête que voit le middleware
 * (`middleware.ts`) ; seuls les préchargements de pages françaises lui
 * échappent, où un en-tête forgé ne change que la réponse de son auteur.
 */
export const LOCALE_HEADER = "x-bg-locale";

/** Fuseau de tout formatage de date (`next-intl`), quelle que soit la langue. */
export const SITE_TIME_ZONE = "Europe/Paris";

/** Valeur `og:locale` de chaque langue. */
export const OPEN_GRAPH_LOCALE: Readonly<Record<Locale, string>> = { fr: "fr_FR", en: "en_US" };

/** Nom de chaque langue dans **sa propre** langue, pour le sélecteur. */
export const LOCALE_NATIVE_NAME: Readonly<Record<Locale, string>> = { fr: "Français", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** La langue portée par un en-tête de requête, `fr` pour tout le reste. */
export function localeFromHeader(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Préfixe d'adresse d'une langue (`""` pour la langue par défaut). */
function localePrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

/**
 * Langue et chemin sans préfixe d'un chemin demandé.
 *
 * Seul un **segment** entier compte : `/en` et `/en/regles` sont anglais,
 * `/enquete` ne l'est pas. `/fr/…` est rendu tel quel avec `prefixed: "fr"` :
 * le middleware le redirige vers l'adresse sans préfixe (une URL par contenu).
 */
export function splitLocalePrefix(pathname: string): { locale: Locale; path: string; prefixed: Locale | null } {
  for (const locale of LOCALES) {
    const prefix = `/${locale}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const rest = pathname.slice(prefix.length);
      return { locale, path: rest === "" ? "/" : rest, prefixed: locale };
    }
  }
  return { locale: DEFAULT_LOCALE, path: pathname, prefixed: null };
}

/** Un chemin sans préfixe correspond-il à un motif de la liste blanche ? */
function matchesRoutePattern(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, index) => (segment.startsWith("[") && segment.endsWith("]") ? got[index] !== "" : segment === got[index]));
}

/** Retire une barre oblique finale (`/regles/` → `/regles`), jamais celle de `/`. */
function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * La route (chemin **sans** préfixe, sans requête ni ancre) a-t-elle sa
 * version anglaise ? Voir `lib/shared/i18n-routes.ts`.
 */
export function isMigratedRoute(path: string): boolean {
  const clean = trimTrailingSlash(path);
  return MIGRATED_ROUTES.some((pattern) => matchesRoutePattern(clean, pattern));
}

/** `/api` et tout ce qui est dessous : jamais de préfixe de langue. */
export function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

/**
 * L'adresse d'un chemin interne dans une langue.
 *
 * - Une adresse qui n'est pas un chemin interne (`https://…`, `//hôte`,
 *   `mailto:`, `#ancre`, chemin relatif) ressort telle quelle.
 * - Un chemin déjà préfixé est d'abord ramené à sa forme nue : on ne
 *   double jamais le préfixe.
 * - En anglais, seule une route **traduite** prend `/en` ; les autres restent en
 *   français (le lien mène à la vraie page, pas à une redirection).
 * - Requête et ancre sont conservées.
 */
export function localeHref(href: string, locale: Locale): string {
  if (!isInternalPath(href)) return href;
  const cut = href.search(/[?#]/);
  const pathname = cut === -1 ? href : href.slice(0, cut);
  const suffix = cut === -1 ? "" : href.slice(cut);
  const { path } = splitLocalePrefix(pathname);
  // Retiré, le préfixe peut démasquer une adresse d'un autre site :
  // `/en//evil.test` deviendrait `//evil.test`. Le lien reste alors tel quel —
  // un chemin du site, que le navigateur ne lit pas comme un autre hôte.
  if (!isInternalPath(path)) return href;
  if (locale === DEFAULT_LOCALE || isApiPath(path) || !isMigratedRoute(path)) return `${path}${suffix}`;
  return `${localePrefix(locale)}${path === "/" ? "" : path}${suffix}`;
}

/** Un chemin du site (`/x`), et non une adresse externe ou relative. */
export function isInternalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}

/**
 * Le lien, depuis une page en `locale`, mène-t-il à une page d'**une autre
 * langue** ? Sur une page anglaise, c'est le cas de tout lien vers une route
 * pas encore traduite — qui doit alors être une navigation complète
 * (`components/i18n/locale-navigation.tsx`).
 */
export function crossesLocale(href: string, locale: Locale): boolean {
  if (!isInternalPath(href)) return false;
  return splitLocalePrefix(localeHref(href, locale).split(/[?#]/)[0]).locale !== locale;
}

/**
 * Les adresses de chaque langue d'une route traduite, `null` sinon — base des
 * `hreflang` (`pageMetadata`) et du sitemap. `x-default` vise le français.
 */
export function localeAlternates(path: string): Record<Locale | "x-default", string> | null {
  if (!isMigratedRoute(path)) return null;
  return {
    fr: localeHref(path, "fr"),
    en: localeHref(path, "en"),
    "x-default": localeHref(path, DEFAULT_LOCALE),
  };
}
