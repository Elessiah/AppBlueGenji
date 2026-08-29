/**
 * Cache des agrégats de la vitrine.
 *
 * Même principe que `tournaments/list-cache.ts` : la page d'accueil relance une
 * dizaine d'agrégations à chaque visite, elles sont identiques pour tout le
 * monde, on les mutualise.
 *
 * Module séparé de `landing-service.ts` pour la même raison que le cache des
 * listes : `tournaments/notifications.ts` doit pouvoir invalider ces entrées
 * sans importer le service, qui importe lui-même `tournaments-service` — le
 * cycle serait immédiat.
 */
import { cached, invalidateCachedPrefix } from "@/lib/server/cache";

const PREFIX = "landing:";

/**
 * Durée de vie des agrégats. Elle ne borne plus que la dérive d'un chiffre qui
 * bougerait sans passer par une écriture de tournoi : toute écriture invalide
 * l'ensemble (`tournaments/notifications.ts`).
 */
export const LANDING_TTL_MS = 60_000;

/** Le direct porte le score en cours : on le garde court. */
export const LANDING_LIVE_TTL_MS = 5_000;

/** Sert un agrégat de la vitrine, mutualisé entre tous les appels concurrents. */
export function cachedLanding<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  return cached(`${PREFIX}${key}`, ttlMs, loader);
}

/**
 * Oublie tous les agrégats de la vitrine. Appelé dès qu'un tournoi change.
 *
 * Sans cela, un tournoi **supprimé** resterait une minute durant dans le
 * compteur de l'accueil, dans le classement (recalculé depuis `bg_matches`) et
 * dans le ticker — qui pointerait alors vers une page introuvable
 * (`docs/features/TOURNAMENT_DELETION.md`).
 */
export function invalidateLandingAggregates(): void {
  invalidateCachedPrefix(PREFIX);
}
