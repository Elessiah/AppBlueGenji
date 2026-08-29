/**
 * Cache de la liste publique des tournois.
 *
 * La liste est la requête la plus sollicitée du site : la page d'accueil est
 * rendue dynamiquement à chaque visite, la page `/tournois` la charge à
 * l'ouverture, et le bandeau « en direct » la redemande périodiquement. Elle
 * agrège pourtant tous les tournois et toutes les inscriptions — et elle est
 * **identique pour tout le monde**.
 *
 * On la mutualise donc, avec une durée de vie courte doublée d'une invalidation
 * à chaque écriture (`./notifications`). Un F5 en rafale ne coûte alors plus
 * rien.
 *
 * Module séparé de `./index` pour que `./notifications` puisse invalider sans
 * créer de cycle d'import.
 */
import { cached, invalidateCachedPrefix } from "@/lib/server/cache";

const PREFIX = "tournaments-list:";

/**
 * Durée de vie d'une liste. Elle ne borne que le retard d'une bascule d'état
 * (« les inscriptions viennent d'ouvrir ») : toute écriture invalide l'entrée,
 * et le client fait de son côté basculer l'affichage à l'heure exacte sans rien
 * demander (`lib/shared/tournament-state.ts`).
 */
export const TOURNAMENT_LIST_TTL_MS = 15_000;

/** Sert la liste `key`, mutualisée entre tous les appels concurrents. */
export function cachedTournamentList<T>(key: string, loader: () => Promise<T>): Promise<T> {
  return cached(`${PREFIX}${key}`, TOURNAMENT_LIST_TTL_MS, loader);
}

/** Oublie toutes les listes en cache. Appelé dès qu'un tournoi change. */
export function invalidateTournamentLists(): void {
  invalidateCachedPrefix(PREFIX);
}
