/**
 * Cache du classement du site.
 *
 * Le classement n'est plus une somme par équipe qu'un `GROUP BY` rend en une
 * passe : c'est un **rejeu** de toutes les rencontres du site dans l'ordre
 * chronologique (`lib/shared/ranking.ts`). Le calcul reste modeste — quelques
 * milliers de matchs, une multiplication chacun — mais il est lu par les vues
 * les plus fréquentées du site : l'annuaire `/equipes`, le leaderboard de
 * l'accueil (deux fois, la tendance comparant deux photos), chaque fiche
 * d'équipe. Sans mutualisation, une soirée de tournoi le relance à chaque
 * rafraîchissement de chaque spectateur.
 *
 * Le cache à vol unique le ramène à un calcul par fenêtre **et** par pointe de
 * lecteurs simultanés.
 *
 * Module séparé du service pour la même raison que le cache des listes et celui
 * de la vitrine : `tournaments/notifications.ts` doit pouvoir invalider ces
 * entrées sans importer le service, dont la chaîne d'imports refermerait un
 * cycle.
 */
import { cached, invalidateCachedPrefix } from "@/lib/server/cache";

const PREFIX = "ranking:";

/**
 * Durée de vie du classement rejoué.
 *
 * Elle ne borne que la dérive d'un chiffre qui bougerait sans passer par une
 * écriture de tournoi : **tout** score qui tombe invalide l'entrée
 * (`tournaments/notifications.ts`), y compris celui qui clôt un match sans rien
 * changer d'autre — le classement, lui, en dépend.
 */
export const RANKING_TTL_MS = 60_000;

/** Sert un classement rejoué, mutualisé entre tous les appels concurrents. */
export function cachedRanking<T>(key: string, loader: () => Promise<T>): Promise<T> {
  return cached(`${PREFIX}${key}`, RANKING_TTL_MS, loader);
}

/**
 * Oublie le classement. Appelé dès qu'un match bouge — un score corrigé ne
 * déplace pas seulement son propre résultat, il **rejoue** tout ce qui suit.
 */
export function invalidateTeamRanking(): void {
  invalidateCachedPrefix(PREFIX);
}
