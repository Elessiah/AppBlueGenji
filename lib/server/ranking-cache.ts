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
import { cached, invalidateCached, invalidateCachedPrefix } from "@/lib/server/cache";
import { invalidateLandingLeaderboards, invalidateLandingTeamViews } from "@/lib/server/landing-cache";
import { invalidateRankingShareImages } from "@/lib/server/share-image-cache";

const PREFIX = "ranking:";

/**
 * Clé des comptes supprimés sans fiche (`users/profileless-players.ts`) : hors
 * du préfixe du classement, qu'un score vide — seule une écriture d'identité
 * (suppression, réactivation, rattrapage) l'oublie, plus bas.
 */
export const PROFILELESS_PLAYERS_CACHE_KEY = "profileless-players";

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
 * Oublie le classement. Appelé dès qu'un match bouge : le classement entier est
 * rejoué depuis `bg_matches`, donc aucune entrée n'en réchappe — ni les
 * leaderboards de la vitrine, qui en sont la mise en forme et que `/classement`
 * lit aussi (`getLeaderboardRows`) : un score s'y voit aussitôt.
 */
export function invalidateTeamRanking(): void {
  invalidateRankingReplay();
  // Un tournoi supprimé peut retirer à un compte anonymisé son seul match
  // joué : sa fiche tombe aussitôt, comme ses liens.
  invalidateCached(PROFILELESS_PLAYERS_CACHE_KEY);
  // Le podium et les cartes nominatives d'aperçu sont rendus depuis ces entrées.
  invalidateRankingShareImages();
}

/** Le rejeu et les leaderboards de la vitrine, sans les PNG d'aperçu. */
function invalidateRankingReplay(): void {
  invalidateCachedPrefix(PREFIX);
  invalidateLandingLeaderboards();
}

/**
 * Comme {@link invalidateTeamRanking} pour un **score** (rapporté ou arbitré)
 * et toute autre écriture de tournoi (`publishUpdatedEvent` : avancée, salon
 * vocal, horaire, inscription ; bascule d'état ou contenu changé par la
 * synchronisation, `tournaments/snapshot.ts`) : le rejeu et les leaderboards sont vidés
 * aussitôt, les PNG d'aperçu **au plus une fois par fenêtre** (ci-dessous). Une
 * suppression de tournoi, elle, vide tout aussitôt (`invalidateTeamRanking`).
 */
export function invalidateTeamRankingForScore(): void {
  invalidateRankingReplay();
  invalidateRankingShareImagesForScore();
}

/** Dernier vidage des PNG d'aperçu pour cause de score (`Date.now()`), 0 = jamais. */
let lastScoreShareFlushAt = 0;

/**
 * Vide les PNG d'aperçu tirés du classement, au plus une fois par
 * {@link RANKING_TTL_MS} pour les **scores** ({@link invalidateTeamRankingForScore}). Un soir de tournoi chargé, chaque
 * score vidait tous les PNG : les rendus Satori/`sharp` du Raspberry Pi suivaient
 * le nombre de matchs au lieu d'un par fenêtre. Un PNG gardé après un score non
 * vidé n'a que l'âge de sa propre échéance (60 s) de retard — la même fenêtre
 * que l'aperçu avait avant. Les écritures d'**identité** (nom, logo, liste :
 * {@link invalidateRankingLists}) vident toujours aussitôt, sans passer par ici.
 */
function invalidateRankingShareImagesForScore(): void {
  const now = Date.now();
  if (lastScoreShareFlushAt !== 0 && now - lastScoreShareFlushAt >= 0 && now - lastScoreShareFlushAt < RANKING_TTL_MS) {
    return;
  }
  lastScoreShareFlushAt = now;
  invalidateRankingShareImages();
}

/** Remet la fenêtre de vidage à zéro — pour les tests seulement. */
export function resetScoreShareFlushForTests(): void {
  lastScoreShareFlushAt = 0;
}

/**
 * Sous-préfixe des entrées **tirées de la liste** du classement (marches du
 * podium, podium et fiches de la carte d'aperçu) : elles dépendent de qui figure
 * à la liste (`deleted_at`, `solo_user_id`), pas seulement du rejeu.
 */
export const RANKING_LIST_KEY_PREFIX = "list:";

/**
 * Oublie les seules entrées tirées de la liste, et garde le rejeu
 * (`state:<fenêtre>:<jeu>`). Pour une écriture qui change la liste sans toucher
 * aux matchs — une dissolution : vider tout le préfixe relancerait jusqu'à six
 * rejeux complets à la lecture suivante, pour un état qui n'a pas bougé.
 */
export function invalidateRankingLists(): void {
  invalidateCachedPrefix(`${PREFIX}${RANKING_LIST_KEY_PREFIX}`);
  // Les PNG du podium et des cartes nominatives en sont tirés : sans cela, ils
  // gardaient l'ancien nom ou l'ancien logo jusqu'à leur échéance.
  invalidateRankingShareImages();
}

/**
 * Oublie tout ce qui **nomme ou montre** une équipe du classement sans toucher
 * aux matchs : les entrées tirées de la liste (identités, podium, cartes
 * d'aperçu et leurs PNG) et les vues de la vitrine qui nomment des équipes.
 * Pour toute écriture d'identité — nom, logo (changé, retiré, mis en
 * quarantaine, rétabli), statut de fantôme, dissolution. Le rejeu reste en
 * cache : il ne lit que les matchs.
 */
export function invalidateTeamIdentityViews(): void {
  invalidateRankingLists();
  invalidateCached(PROFILELESS_PLAYERS_CACHE_KEY);
  invalidateLandingTeamViews();
}
