/**
 * Qui a le droit d'ouvrir la fiche d'un tournoi pas encore publié.
 *
 * `start_visibility_at` est la date à partir de laquelle un tournoi existe pour
 * le public. `/tournois` la respecte depuis toujours — sa liste filtre en SQL —
 * mais la **fiche** ne la consultait nulle part : un compte sans le moindre rôle
 * qui devinait l'identifiant obtenait `HTTP 200` sur la lecture REST, sur le flux
 * SSE et donc sur la page. Le nom, la description, les dates et le plateau d'un
 * tournoi en préparation étaient lisibles avant l'annonce.
 *
 * La règle tient en une ligne : **un tournoi invisible n'est lisible que par la
 * permission `tournaments`**. C'est exactement l'audience de la section
 * « Tournois invisibles » (`GET /api/tournaments?scope=hidden`) — une seule
 * règle, un seul public, aucune divergence possible entre la liste et la fiche.
 * Le cast (`casting`) n'y a pas droit : il ne voit pas ces tournois en liste non
 * plus, et commenter un tournoi non annoncé n'a pas de sens.
 *
 * Module pur, partagé, pour que les deux portes de lecture — le flux SSE, chemin
 * nominal, et la lecture REST de secours — appliquent la même chose. Le serveur
 * reste seul juge : le client ne fait aucun appel à ce module.
 */

/** Ce que le module a besoin de connaître du tournoi : sa date de publication. */
export type TournamentVisibilityInput = {
  /** `bg_tournaments.start_visibility_at`, en ISO ou en `Date`. */
  startVisibilityAt: string | Date;
};

/** Droits du lecteur qui pèsent sur la visibilité. */
export type TournamentVisibilityViewer = {
  /** Permission `tournaments` : arbitre ou administrateur. */
  canManage: boolean;
};

function timeOf(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Le tournoi est-il publié à l'instant `now` ?
 *
 * Une date illisible est traitée comme **non publiée** : c'est une garde
 * d'accès, elle se ferme quand elle ne sait pas. La colonne est `NOT NULL` et
 * n'est écrite qu'après validation, donc le cas suppose une donnée abîmée — que
 * le staff, lui, voit toujours et peut corriger.
 */
export function isTournamentPublished(
  tournament: TournamentVisibilityInput,
  now: Date = new Date(),
): boolean {
  const visibleAt = timeOf(tournament.startVisibilityAt);
  if (Number.isNaN(visibleAt)) return false;
  return visibleAt <= now.getTime();
}

/**
 * Ce lecteur peut-il lire ce tournoi ?
 *
 * Un refus doit se traduire par **404**, jamais par 403 : répondre « interdit »
 * sur un tournoi qu'on prétend invisible confirmerait son existence, et
 * l'identifiant étant un entier consécutif, l'existence est justement ce qu'on
 * protège.
 */
export function canViewTournament(
  tournament: TournamentVisibilityInput,
  viewer: TournamentVisibilityViewer,
  now: Date = new Date(),
): boolean {
  return viewer.canManage || isTournamentPublished(tournament, now);
}
