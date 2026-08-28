/**
 * Reclassement local des tournois selon l'heure du client.
 *
 * Le serveur range les tournois par état au moment où il répond. Une liste
 * chargée à 19 h 58 montrera donc encore « Prochainement » à 20 h 00, heure
 * d'ouverture des inscriptions — et c'est très exactement le moment où les gens
 * rechargent la page en boucle pour voir si ça a bougé.
 *
 * Rien n'oblige pourtant à redemander : l'horaire est déjà dans la carte, et
 * l'état s'en déduit ({@link computeTournamentState}). Le client peut donc
 * reclasser tout seul, à la seconde près, sans une requête. Le serveur reste
 * seul juge de ce qu'il autorise — reclasser ne fait qu'anticiper l'affichage
 * d'une information publique.
 *
 * Module pur, testable sans navigateur.
 */
import type { TournamentBuckets, TournamentCard } from "./types";
import { computeTournamentState, nextTournamentStateChangeAt } from "./tournament-state";

/** Tous les tournois des paniers, dans l'ordre du serveur (début décroissant). */
function flatten(buckets: TournamentBuckets): TournamentCard[] {
  return [
    ...buckets.running,
    ...buckets.registration,
    ...buckets.upcoming,
    ...buckets.finished,
  ];
}

/**
 * Reclasse les paniers d'après l'heure `now`, en corrigeant au passage l'état
 * porté par chaque carte pour que la pastille affichée corresponde au panier.
 *
 * L'ordre du serveur (par date de début décroissante) est reconstitué : une
 * carte qui change de panier reste à sa place dans le tri, pas collée à la fin.
 */
export function rescheduleBuckets(
  buckets: TournamentBuckets,
  now: number = Date.now(),
): TournamentBuckets {
  const rescheduled: TournamentBuckets = {
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  };

  const cards = flatten(buckets)
    .map((card) => {
      const state = computeTournamentState(
        {
          state: card.state,
          registrationOpenAt: card.registrationOpenAt,
          registrationCloseAt: card.registrationCloseAt,
          startAt: card.startAt,
        },
        now,
      );
      return state === card.state ? card : { ...card, state };
    })
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  for (const card of cards) {
    if (card.state === "UPCOMING") rescheduled.upcoming.push(card);
    else if (card.state === "REGISTRATION") rescheduled.registration.push(card);
    else if (card.state === "RUNNING") rescheduled.running.push(card);
    else rescheduled.finished.push(card);
  }

  return rescheduled;
}

/**
 * Instant du prochain reclassement à prévoir, ou `null` si plus rien ne doit
 * bouger. Un seul minuteur suffit alors pour toute la page.
 */
export function nextBucketsChangeAt(
  buckets: TournamentBuckets,
  now: number = Date.now(),
): number | null {
  let earliest: number | null = null;

  for (const card of flatten(buckets)) {
    const at = nextTournamentStateChangeAt(
      {
        state: card.state,
        registrationOpenAt: card.registrationOpenAt,
        registrationCloseAt: card.registrationCloseAt,
        startAt: card.startAt,
      },
      now,
    );
    if (at !== null && (earliest === null || at < earliest)) earliest = at;
  }

  return earliest;
}
