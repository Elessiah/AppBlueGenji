import { compareLocalText } from "@/lib/shared/dates";
import type { Locale } from "@/lib/shared/locales";
import { isFreeAgent, playerRosterStatus, type PlayerRosterInput } from "@/lib/shared/player-roster-status";

/**
 * Filtres de statut et tri par ancienneté de l'annuaire `/joueurs`, écrits en
 * fonctions pures pour être testés hors du composant.
 */
export type PlayerStatusFilter = "all" | "free" | "unaffiliated";

/**
 * - `all` : tout l'annuaire affiché.
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
  if (filter === "all") return true;
  // Un compte supprimé n'est plus personne à recruter, sous l'un ou l'autre filtre.
  if (player.isDeleted) return false;
  if (filter === "free") return isFreeAgent(player);
  return playerRosterStatus(player) !== "ROSTER";
}

/**
 * Le filtre de statut écarte-t-il d'office les comptes supprimés ? Alors la
 * case « Afficher les comptes supprimés » ne changerait rien à la liste : elle
 * est désactivée tant qu'il est actif.
 */
export function statusFilterExcludesDeleted(filter: PlayerStatusFilter): boolean {
  return filter !== "all";
}

/**
 * État du bouton « Afficher les comptes supprimés » : inerte sous un filtre qui
 * les écarte, et alors jamais « enfoncé » (la liste n'en montre aucun), même si
 * la case avait été activée avant le choix du filtre.
 */
export function deletedToggleState(
  showDeleted: boolean,
  filter: PlayerStatusFilter,
): { inert: boolean; pressed: boolean } {
  const inert = statusFilterExcludesDeleted(filter);
  return { inert, pressed: showDeleted && !inert };
}

/**
 * Les rôles d'un joueur ne viennent que de son équipe (`listPlayers`) : sous un
 * filtre « sans roster », un filtre de rôle rendrait toujours une liste vide.
 * Les puces de rôle sont alors désactivées.
 */
export function statusFilterAllowsRoles(filter: PlayerStatusFilter): boolean {
  return filter === "all";
}

/**
 * Comptes les plus récents d'abord ; à la même seconde, par pseudo dans l'ordre
 * de la langue de la page (`compareLocalText`) — sinon l'ordre suivait la
 * collation de la base. `createdAt` est un ISO normalisé (`toIso`) : l'ordre
 * des chaînes est celui des instants, sans analyse de date. Sans date (compte
 * supprimé, `DirectoryPlayer`) : en fin de liste, par pseudo — jamais mêlé
 * aux comptes vivants.
 */
export function compareNewestFirst(
  locale: Locale,
): (a: { createdAt: string | null; pseudo: string }, b: { createdAt: string | null; pseudo: string }) => number {
  const comparePseudo = compareLocalText(locale);
  return (a, b) => {
    if (a.createdAt !== b.createdAt) {
      if (a.createdAt === null) return 1;
      if (b.createdAt === null) return -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return comparePseudo(a.pseudo, b.pseudo);
  };
}

/** Ordre de l'annuaire : pseudo (langue de la page), tournois joués, plus récents. */
export type PlayerSortKey = "pseudo" | "tournaments" | "created";

type SortablePlayer = { pseudo: string; createdAt: string | null; tournamentsCount?: number };

/**
 * Langue dont dépend un tri : seuls « Pseudo » et « Plus récents » (à égalité
 * de seconde) comparent des pseudos. `null` pour « Tournois » : changer de
 * langue n'a pas à le refaire.
 */
export function sortLocaleOf(sort: PlayerSortKey, locale: Locale): Locale | null {
  return sort === "tournaments" ? null : locale;
}

/** Copie triée de l'annuaire, l'entrée n'est pas touchée. */
export function sortPlayers<T extends SortablePlayer>(players: readonly T[], sort: PlayerSortKey, locale: Locale): T[] {
  const sorted = [...players];
  if (sort === "tournaments") {
    sorted.sort((a, b) => (b.tournamentsCount || 0) - (a.tournamentsCount || 0));
  } else if (sort === "pseudo") {
    const compare = compareLocalText(locale);
    sorted.sort((a, b) => compare(a.pseudo, b.pseudo));
  } else {
    sorted.sort(compareNewestFirst(locale));
  }
  return sorted;
}

type FilterablePlayer = PlayerRosterInput & { isDeleted?: boolean; roles?: readonly string[] };

export type PlayerFilters<R extends string, T> = {
  /** Recherche déjà réduite (`trim` + minuscules) ; vide = pas de recherche. */
  query: string;
  role: R | "all";
  status: PlayerStatusFilter;
  /** Clé de recherche d'un joueur (pseudo et équipe, en minuscules). */
  searchKeyOf: (player: T) => string;
};

/**
 * Filtre l'annuaire trié, dans son ordre. Sans recherche ni filtre, rend la
 * liste telle quelle (même référence), sans la parcourir.
 */
export function filterPlayers<R extends string, T extends FilterablePlayer>(
  sorted: T[],
  { query, role, status, searchKeyOf }: PlayerFilters<R, T>,
): T[] {
  if (!query && role === "all" && status === "all") return sorted;
  return sorted.filter((player) => {
    if (query && !searchKeyOf(player).includes(query)) return false;
    if (role !== "all" && !(player.roles || []).includes(role)) return false;
    return status === "all" || matchesPlayerStatusFilter(player, status);
  });
}

/**
 * Filtre de rôle après le choix d'un statut : un filtre « sans roster » le
 * ramène à « Tous » (les rôles venant de l'équipe, il viderait la liste).
 */
export function roleAfterStatusChoice<R extends string>(role: R | "all", next: PlayerStatusFilter): R | "all" {
  return statusFilterAllowsRoles(next) ? role : "all";
}
