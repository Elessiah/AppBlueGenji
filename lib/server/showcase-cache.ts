/**
 * Cache des lectures de la vitrine.
 *
 * La page d'accueil est rendue à chaque visite (`force-dynamic`) et c'est, de
 * loin, la porte d'entrée du site. Les agrégats de tournois y sont mutualisés
 * (`landing-service`), mais elle lit aussi les sponsors, les statistiques et
 * piliers de l'association, et les textes éditables — cinq requêtes de plus, à
 * chaque visite, pour des contenus que le staff modifie quelques fois par mois.
 *
 * Un plafond de débit ne peut rien ici : ce n'est pas une route API mais le
 * rendu d'un Server Component, qui ne peut pas répondre 429. La mutualisation
 * est donc le seul garde-fou disponible — et cent visiteurs arrivant ensemble
 * ne coûtent plus qu'une lecture de chaque.
 *
 * Comme pour la liste des tournois, la durée de vie n'est qu'un filet : toute
 * écriture appelle {@link invalidateShowcase}, si bien qu'une modification du
 * staff se voit immédiatement.
 */
import { cached, invalidateCachedPrefix } from "./cache";

const PREFIX = "showcase:";

/**
 * Durée de vie d'une lecture de vitrine. Généreuse : ces contenus changent
 * quelques fois par mois, et chaque écriture invalide de toute façon.
 */
export const SHOWCASE_TTL_MS = 60_000;

/** Sert une lecture de vitrine, mutualisée entre tous les appels concurrents. */
export function cachedShowcase<T>(key: string, loader: () => Promise<T>): Promise<T> {
  return cached(`${PREFIX}${key}`, SHOWCASE_TTL_MS, loader);
}

/**
 * Oublie toutes les lectures de vitrine. Appelé à chaque écriture du staff.
 *
 * Volontairement grossier : ces contenus sont minuscules et interdépendants
 * (l'ordre des sponsors, les textes qui les accompagnent), et une écriture reste
 * un événement rare. Distinguer les clés compliquerait sans rien gagner.
 */
export function invalidateShowcase(): void {
  invalidateCachedPrefix(PREFIX);
}
