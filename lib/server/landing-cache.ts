/**
 * Cache des agrégats de la vitrine.
 *
 * La page d'accueil est rendue à chaque visite (`force-dynamic`) et lance une
 * dizaine d'agrégations : sans mutualisation, cent visiteurs — ou un seul qui
 * garde le doigt sur F5 — les relancent cent fois. Le cache à vol unique les
 * ramène à une, et ces chiffres-là n'ont aucun besoin d'être à la seconde.
 *
 * Module séparé de `landing-service.ts` pour la même raison que le cache des
 * listes : `tournaments/notifications.ts` doit pouvoir invalider ces entrées
 * sans importer le service, qui importe lui-même `tournaments-service` — le
 * cycle serait immédiat.
 */
import { cached, invalidateCached, invalidateCachedPrefix } from "@/lib/server/cache";

const PREFIX = "landing:";

/**
 * Durée de vie des agrégats. Elle ne borne plus que la dérive d'un chiffre qui
 * bougerait sans passer par une écriture de tournoi : toute écriture invalide
 * l'ensemble (`tournaments/notifications.ts`).
 */
export const LANDING_TTL_MS = 60_000;

/**
 * Clé du direct de la vitrine, partagée par son lecteur (`getLandingLive`) et
 * son invalidateur ({@link invalidateLandingLive}) : écrite deux fois, elle
 * pourrait diverger, et l'invalidation se ferait alors dans le vide.
 */
export const LANDING_LIVE_KEY = "live";

/** Le direct fait exception : il porte le score en cours, on le garde court. */
export const LANDING_LIVE_TTL_MS = 5_000;

/**
 * Préfixe des leaderboards de la vitrine (`leaderboard:<jeu>`, `all` pour « Général » :
 * la liste entière, découpée à la lecture),
 * partagé par leur lecteur (`getLandingLeaderboard`) et leur invalidateur
 * ({@link invalidateLandingTeamViews}).
 */
export const LANDING_LEADERBOARD_KEY_PREFIX = "leaderboard:";

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

/**
 * Oublie le seul direct de la vitrine (`getLandingLive`).
 *
 * Pour les écritures qui ne touchent qu'**un match** — sa chaîne, son antenne,
 * son horaire : elles déplacent le bouton « Regarder le live », rien d'autre de
 * l'accueil. Vider tout le préfixe pour elles relancerait compteurs, classement
 * et ticker à chaque réglage de diffusion d'une soirée de tournoi.
 */
export function invalidateLandingLive(): void {
  invalidateCached(`${PREFIX}${LANDING_LIVE_KEY}`);
}

/** Clé du bandeau de la vitrine (`getLandingTicker`), partagée avec {@link invalidateLandingTeamViews}. */
export const LANDING_TICKER_KEY = "ticker";

/** Clé des compteurs de la vitrine (`getLandingStats`), partagée avec {@link invalidateLandingTeamViews}. */
export const LANDING_STATS_KEY = "stats";

/**
 * Préfixe du mini-arbre de l'accueil (`mini-bracket:<tournoi>`,
 * `tournaments/bracket-loader.ts`) : sous le préfixe de la vitrine, il est vidé
 * avec ses agrégats à chaque écriture de tournoi, et avec les vues qui nomment
 * des équipes ({@link invalidateLandingTeamViews}).
 */
export const LANDING_MINI_BRACKET_KEY_PREFIX = "mini-bracket:";

/**
 * Oublie les seuls leaderboards de la vitrine. Appelé avec le classement du site
 * (`ranking-cache.ts`, à chaque score) : `/classement` lit la même entrée, et un
 * score doit s'y voir aussitôt, comme quand la page refaisait sa liste.
 */
export function invalidateLandingLeaderboards(): void {
  invalidateCachedPrefix(`${PREFIX}${LANDING_LEADERBOARD_KEY_PREFIX}`);
}

/**
 * Oublie les vues de la vitrine qui **nomment ou comptent des équipes** : les
 * leaderboards, le bandeau (noms des derniers résultats), le mini-arbre et les
 * compteurs (« Équipes actives » écarte les équipes dissoutes, « Joueurs »
 * compte les comptes). Pour une écriture qui change la liste du classement, le
 * nom d'une équipe ou le nombre d'équipes sans toucher aux tournois — une
 * dissolution, qui renomme l'équipe « Équipe dissoute #id », une suppression de
 * compte, qui renomme son entrée solo. Le direct n'y est pas : il ne vit que 5 s
 * (sa durée de vie), le relancer serait perdu.
 */
export function invalidateLandingTeamViews(): void {
  invalidateLandingLeaderboards();
  invalidateCached(`${PREFIX}${LANDING_TICKER_KEY}`);
  invalidateCached(`${PREFIX}${LANDING_STATS_KEY}`);
  invalidateCachedPrefix(`${PREFIX}${LANDING_MINI_BRACKET_KEY_PREFIX}`);
}
