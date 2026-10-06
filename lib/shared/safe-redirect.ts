/**
 * « Où renvoyer le visiteur après sa connexion ? » — et pourquoi la réponse ne
 * peut pas venir de l'URL telle quelle.
 *
 * `/connexion` lit un `?redirect=` pour ramener le visiteur là où il allait (une
 * fiche de tournoi partagée, par exemple : c'est `AuthGate` qui le pose). Cette
 * valeur n'était contrôlée nulle part, si bien que
 * `/connexion?redirect=https://exemple.invalid` déposait l'utilisateur **hors du
 * site** une fois authentifié — une redirection ouverte, l'appât classique du
 * hameçonnage : le lien porte le vrai domaine, la vraie page de connexion, et
 * n'emmène ailleurs qu'après coup, quand la confiance est acquise.
 *
 * La voie Google la reproduisait à l'identique : la destination traverse le
 * cookie d'état OAuth et ressortait par `new URL(redirectTo, base)` — or `new
 * URL` **ignore la base** dès que la valeur est une URL absolue. Une base ne
 * borne rien.
 *
 * D'où cette fonction, unique implémentation, appliquée aux trois portes que la
 * valeur franchit : la page de connexion, l'aller OAuth (qui la range dans le
 * cookie) et le retour OAuth (qui l'en ressort — le cookie n'est pas signé, il
 * ne fait pas foi).
 */

import { DEFAULT_LOCALE, localeHref, splitLocalePrefix, type Locale } from "./locales";
import { trimTrailingSlashes } from "./trim-trailing";

/** Destination de repli : l'accueil de l'espace compétitif. */
export const DEFAULT_REDIRECT = "/tournois";

/**
 * Les caractères que les navigateurs **retirent** d'une URL avant de la
 * résoudre : tabulation, saut de ligne, retour chariot.
 *
 * Sans eux, `/\n/exemple.invalid` passerait le test « commence par une seule
 * barre » puis serait résolu en `//exemple.invalid` — soit une URL
 * protocole-relative, donc un autre domaine. On refuse plutôt que de nettoyer :
 * une destination légitime n'en contient jamais.
 */
const STRIPPED_BY_BROWSERS = /[\u0000-\u001f\u007f]/;

/**
 * Rend un chemin **du site**, ou la destination de repli.
 *
 * N'est accepté qu'un chemin absolu d'une seule barre (`/tournois/12?onglet=1`).
 * Sont refusés :
 *
 * - tout ce qui n'est pas une chaîne (paramètre absent, tableau, objet) ;
 * - une URL absolue (`https://…`, `javascript:…`) — elle ne commence pas par
 *   `/` ;
 * - une URL protocole-relative (`//exemple.invalid`), qui change de domaine sans
 *   nommer de schéma ;
 * - sa variante à contre-barre (`/\exemple.invalid`), que les navigateurs
 *   traitent comme la précédente ;
 * - tout ce qui porte un caractère de contrôle, retiré par le navigateur avant
 *   résolution et qui ferait réapparaître les cas ci-dessus.
 */
export function safeRedirectPath(value: unknown, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (candidate.length === 0) return fallback;
  if (STRIPPED_BY_BROWSERS.test(candidate)) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  // `//` comme `/\` : le navigateur y lit une autorité, pas un chemin.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (UNSAFE_PATH_SEPARATOR.test(pathPart(candidate))) return fallback;

  return candidate;
}

/**
 * Séparateurs qu'un chemin du site ne porte **jamais**, où qu'ils soient dans
 * le chemin (requête et ancre exclues) : `//`, la contre-barre, et leurs formes
 * encodées (`%2F`, `%5C`).
 *
 * Depuis la page anglaise (lot 6), une destination porte un préfixe de langue,
 * que `localeHref` retire puis repose : `/en//exemple.invalid` y redevenait
 * `//exemple.invalid` sans ce refus. `localeHref` se garde lui-même de ce cas,
 * mais la règle tient ici, à la seule porte d'entrée : rien d'ambigu n'entre
 * dans le cookie d'état ni n'atteint `router.push`. Une contre-barre, qu'un
 * navigateur lit comme une barre, ou une barre encodée, qu'un relais peut
 * décoder, ne servent qu'à reconstituer ces formes.
 */
const UNSAFE_PATH_SEPARATOR = /\/\/|\\|%2f|%5c/i;

/** Le chemin seul d'une adresse du site, sans requête ni ancre. */
function pathPart(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

/**
 * Destination d'après connexion, **dans la langue de la page de connexion** :
 * `/en/connexion?redirect=/regles` ramène sur `/en/regles`, `/connexion?redirect=/en/regles`
 * sur `/regles` — la page qu'on vient de lire dit la langue, comme le reste du
 * site (`localeHref`, qui laisse française une route pas encore traduite).
 * Filtrée d'abord par `safeRedirectPath`.
 */
export function loginDestination(value: unknown, locale: Locale): string {
  return localeHref(safeRedirectPath(value), locale);
}

/**
 * Destination **scellée** dans le cookie d'état OAuth (`bg_oauth`), avec la
 * langue de la page de départ : l'adresse de la page dans cette langue, préfixe
 * compris **même pour une route pas encore traduite** (`/en/tournois`, qui
 * répondrait 307 vers `/tournois`). Le cookie ne porte ainsi rien de plus que
 * « la page où vous ramener » (`/rgpd`) ; la langue s'y relit au retour
 * ({@link sealedReturnLocale}) pour revenir sur `/en/connexion` après un refus.
 */
export function sealedReturnPath(value: unknown, locale: Locale): string {
  const safe = safeRedirectPath(value);
  const path = pathPart(safe);
  const suffix = safe.slice(path.length);
  const bare = splitLocalePrefix(path).path;
  if (locale === DEFAULT_LOCALE) return `${bare}${suffix}`;
  return `/${locale}${bare === "/" ? "" : bare}${suffix}`;
}

/** Langue scellée par {@link sealedReturnPath} ; le français pour tout le reste (cookie antérieur, valeur absente). */
export function sealedReturnLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  return splitLocalePrefix(pathPart(safeRedirectPath(value))).locale;
}

/** Chemin de la page de connexion, exclu des destinations d'un visiteur déjà connecté. */
const LOGIN_PATH = "/connexion";

/**
 * Destination d'un visiteur **déjà connecté** qui ouvre `/connexion` : là où il
 * allait (`?redirect=`, filtré par `safeRedirectPath`), `DEFAULT_REDIRECT`
 * sinon. Une destination qui ramène à `/connexion` elle-même est écartée — la
 * page redirigerait vers elle-même à l'infini. La comparaison porte sur le
 * chemin **tel que le navigateur le résoudra** (`.`/`..` retirés, encodage
 * défait) : `/tournois/../connexion` ou `/%63onnexion` y mènent aussi.
 */
export function signedInLoginRedirect(value: unknown): string {
  const target = safeRedirectPath(value);
  let path: string;
  try {
    path = decodeURIComponent(new URL(target, "http://site.invalid").pathname); // NOSONAR typescript:S5332 — base fictive pour analyser un chemin, aucune requête
  } catch {
    // Encodage illisible : dans le doute, la destination par défaut.
    return DEFAULT_REDIRECT;
  }
  // `/en/connexion` est la même page (lot 6) : comparée sans préfixe de langue.
  path = splitLocalePrefix(trimTrailingSlashes(path)).path;
  return path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`) ? DEFAULT_REDIRECT : target;
}
