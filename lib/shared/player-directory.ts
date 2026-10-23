import { isFreeAgent, playerRosterStatus, type PlayerRosterInput } from "@/lib/shared/player-roster-status";

/**
 * Filtres de statut et tri par ancienneté de l'annuaire `/joueurs`, écrits en
 * fonctions pures pour être testés hors du composant.
 */
export type PlayerStatusFilter = "all" | "free" | "unaffiliated";

/**
 * - `free` : free agents (sans roster **et** ouverts au recrutement).
 * - `unaffiliated` : tout joueur sans roster, ouvert ou non — les cartes
 *   « FREE AGENT » et « SANS ÉQUIPE » réunies. Un compte supprimé n'en est
 *   jamais : sans équipe par construction, il n'est plus personne à recruter,
 *   et la case « comptes supprimés » en remplirait sinon le filtre.
 *
 * Le statut se lit sur `lib/shared/player-roster-status.ts`, seule définition
 * partagée avec la carte et le compteur.
 */
export function matchesPlayerStatusFilter(
  player: PlayerRosterInput & { isDeleted?: boolean },
  filter: PlayerStatusFilter,
): boolean {
  if (filter === "free") return isFreeAgent(player);
  if (filter === "unaffiliated") return !player.isDeleted && playerRosterStatus(player) !== "ROSTER";
  return true;
}

/**
 * Comptes les plus récents d'abord. `createdAt` est un ISO normalisé
 * (`toIso`) : l'ordre des chaînes est celui des instants, sans analyse de date.
 */
export function compareNewestFirst(a: { createdAt: string }, b: { createdAt: string }): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}
