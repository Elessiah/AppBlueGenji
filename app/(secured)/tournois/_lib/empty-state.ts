import { hasActiveFilter, type GameFilter } from "./buckets";

/**
 * État vide de `/tournois` (`docs/features/TOURNOIS_LIST_EMPTY_LOOK.md`) :
 *
 * - `empty` : aucune section à montrer, aucun filtre — le site n'a rien publié ;
 * - `filtered` : aucune section, mais une recherche ou un jeu choisi les a vidées ;
 * - `nothingUpcoming` : des sections, mais rien à rejoindre (ni inscriptions
 *   ouvertes, ni tournoi annoncé) — la page ne s'arrête plus sur un grand vide
 *   sous une ou deux cartes ;
 * - `null` : rien à dire (liste pas encore lue, ou de quoi s'inscrire).
 *
 * Une recherche tapée ne donne jamais `nothingUpcoming` : son résultat répond
 * déjà, et « aucun tournoi à venir » y serait faux. Un jeu choisi, lui, le
 * garde : « rien à venir en Marvel Rivals » reste vrai.
 */
export type ListEmptyKind = "empty" | "filtered" | "nothingUpcoming";

export function listEmptyKind({
  loaded,
  shownSections,
  upcomingCount,
  query,
  gameFilter,
}: Readonly<{
  /** La porte d'affichage est ouverte (première liste lue). */
  loaded: boolean;
  /** Nombre de sections rendues (compte > 0). */
  shownSections: number;
  /** Inscriptions ouvertes + tournois annoncés, « Mes tournois » compris. */
  upcomingCount: number;
  query: string;
  gameFilter: GameFilter;
}>): ListEmptyKind | null {
  if (!loaded) return null;
  if (shownSections === 0) return hasActiveFilter(query, gameFilter) ? "filtered" : "empty";
  if (upcomingCount === 0 && query.trim() === "") return "nothingUpcoming";
  return null;
}
