/**
 * Ordre de seeding d'un tournoi — logique pure, partagée client/serveur.
 *
 * Le seeding est l'ordre des équipes inscrites : il détermine les appariements
 * de la première manche dans **tous** les formats (haut de tableau contre bas
 * de tableau en élimination et en ronde suisse, couples adjacents en survie).
 *
 * Il reste modifiable par le staff tant qu'**aucun score n'a été saisi** : au
 * premier score, le tournoi est engagé et rejouer les appariements réécrirait
 * des matchs déjà joués. C'est la même définition de « saisie » que le
 * verrouillage des scores (`match-lock.ts`), byes et matchs fantômes exclus.
 */
import { hasScoreInput, type MatchScoreState } from "./match-lock";
import type { TournamentState } from "./types";

export type SeedingEntry = {
  teamId: number;
  teamName: string;
  /** Rang dans l'ordre de seeding, à partir de 1. */
  seed: number;
};

export type SeedingLockReason = "FINISHED" | "SCORES_ENTERED" | null;

/**
 * Pourquoi le seeding est-il figé ? `null` = encore modifiable.
 *
 * - `FINISHED` : tournoi terminé, l'ordre n'a plus aucun effet.
 * - `SCORES_ENTERED` : au moins un match porte une saisie.
 */
export function seedingLockReason(
  state: TournamentState,
  matches: MatchScoreState[],
): SeedingLockReason {
  if (state === "FINISHED") return "FINISHED";
  if (matches.some(hasScoreInput)) return "SCORES_ENTERED";
  return null;
}

/** Raccourci lisible : le seeding est-il encore réordonnable ? */
export function canReorderSeeding(state: TournamentState, matches: MatchScoreState[]): boolean {
  return seedingLockReason(state, matches) === null;
}

/**
 * Déplace une équipe d'un cran dans l'ordre (boutons ↑ / ↓).
 *
 * Renvoie le tableau inchangé si l'équipe est absente, ou déjà à l'extrémité
 * visée — le bouton correspondant est alors désactivé côté interface.
 */
export function moveInOrder(
  order: readonly number[],
  teamId: number,
  direction: "up" | "down",
): number[] {
  const index = order.indexOf(teamId);
  if (index === -1) return [...order];

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return [...order];

  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * L'ordre proposé est-il une permutation exacte des équipes inscrites ?
 * Refuse les doublons, les manquantes et les intruses — sans quoi une équipe
 * pourrait disparaître du tournoi via un simple réordonnancement.
 */
export function isValidSeedOrder(
  registeredTeamIds: readonly number[],
  proposedOrder: readonly number[],
): boolean {
  if (proposedOrder.length !== registeredTeamIds.length) return false;

  const proposed = new Set(proposedOrder);
  if (proposed.size !== proposedOrder.length) return false;

  return registeredTeamIds.every((teamId) => proposed.has(teamId));
}

/** Applique un ordre à des entrées et renumérote les seeds de 1 à N. */
export function applySeedOrder(
  entries: readonly SeedingEntry[],
  order: readonly number[],
): SeedingEntry[] {
  const byId = new Map(entries.map((entry) => [entry.teamId, entry]));
  // Les identifiants inconnus sont écartés AVANT la renumérotation, sinon ils
  // laisseraient un trou dans la suite des seeds.
  return order
    .flatMap((teamId) => {
      const entry = byId.get(teamId);
      return entry ? [entry] : [];
    })
    .map((entry, index) => ({ ...entry, seed: index + 1 }));
}
