/**
 * Cache des statistiques des fiches et de l'annuaire des joueurs.
 *
 * Ces lectures sont les plus lourdes que puisse déclencher un simple
 * rafraîchissement de page : la fiche d'une équipe ou d'un joueur recharge tous
 * ses matchs et toutes ses inscriptions, et l'annuaire `/joueurs` fait de même
 * pour **tous** les comptes du site, avant un découpage par joueur en mémoire.
 * Rien ne les mutualisait : F5 maintenu sur `/joueurs` relançait l'agrégat
 * complet à chaque chargement, et plusieurs lecteurs pouvaient occuper toutes
 * les connexions du pool.
 *
 * Le cache à vol unique ramène ce coût à un calcul par fenêtre **et** par
 * pointe de lecteurs simultanés. Seules les parties **dérivées des matchs**
 * sont mises en cache — jamais une ligne de compte, dont la visibilité dépend
 * du lecteur et qu'un réglage de profil doit changer sur-le-champ.
 *
 * Module séparé du service pour la même raison que le cache du classement :
 * `tournaments/notifications.ts` doit pouvoir l'invalider sans importer le
 * service, dont la chaîne d'imports refermerait un cycle.
 */
import { cached, invalidateCachedPrefix } from "@/lib/server/cache";

const PREFIX = "stats:";

/**
 * Durée de vie d'une statistique mise en cache.
 *
 * Tout score qui tombe l'invalide (`tournaments/notifications.ts`), comme le
 * classement. La durée ne borne donc que ce qui bouge **sans** écriture de
 * tournoi : l'arrivée ou le départ d'un joueur dans une équipe, qui déplace les
 * fenêtres d'appartenance de son bilan. Trente secondes de retard sur un bilan
 * après un changement de roster, contre un agrégat complet par chargement.
 */
export const STATS_TTL_MS = 30_000;

/** Sert une statistique, mutualisée entre tous les appels concurrents. */
export function cachedStats<T>(key: string, loader: () => Promise<T>): Promise<T> {
  return cached(`${PREFIX}${key}`, STATS_TTL_MS, loader);
}

/**
 * Oublie toutes les statistiques. Appelé dès qu'un match bouge : un score
 * corrigé change le bilan des deux engagées et de chacun de leurs joueurs, et
 * les retrouver une à une coûterait plus que de tout recalculer.
 */
export function invalidateStats(): void {
  invalidateCachedPrefix(PREFIX);
}
