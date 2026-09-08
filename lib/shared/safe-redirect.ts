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

  return candidate;
}
