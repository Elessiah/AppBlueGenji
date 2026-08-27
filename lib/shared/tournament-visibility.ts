import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

/**
 * Un tournoi reste **non visible** tant que sa date d'ouverture à la visibilité
 * n'est pas passée : la liste des tournois l'exclut côté serveur
 * (`listTournamentBuckets`), personne ne le voit passer. Seul son organisateur
 * peut le retrouver, par l'onglet « Mes tournois ».
 *
 * Une date illisible est traitée comme visible : mieux vaut afficher un tournoi
 * dans sa section d'état que le faire disparaître dans un tiroir « masqué ».
 */
export function isTournamentHidden(
  tournament: Pick<TournamentCard, "startVisibilityAt">,
  now: number = Date.now(),
): boolean {
  const visibleAt = new Date(tournament.startVisibilityAt).getTime();
  return Number.isFinite(visibleAt) && visibleAt > now;
}

/**
 * Sépare les tournois encore masqués du reste des paniers.
 *
 * Les masqués sont regroupés dans une seule liste — leur état importe moins que
 * le fait qu'ils n'existent pour personne d'autre —, dans l'ordre des paniers
 * (en cours, inscriptions, à venir, terminés) et sans toucher à l'ordre interne
 * de chacun. En pratique un tournoi masqué est toujours « à venir » (la
 * visibilité précède l'ouverture des inscriptions), mais la séparation ne s'y
 * fie pas : une date reprise à la main peut masquer un tournoi déjà lancé.
 */
export function splitHiddenTournaments(
  buckets: TournamentBuckets,
  now: number = Date.now(),
): { hidden: TournamentCard[]; visible: TournamentBuckets } {
  const hidden: TournamentCard[] = [];
  const visible: TournamentBuckets = {
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  };

  const keys = ["running", "registration", "upcoming", "finished"] as const;
  for (const key of keys) {
    for (const tournament of buckets[key]) {
      if (isTournamentHidden(tournament, now)) hidden.push(tournament);
      else visible[key].push(tournament);
    }
  }

  return { hidden, visible };
}
