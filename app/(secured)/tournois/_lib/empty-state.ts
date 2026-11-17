import { hasActiveFilter, type GameFilter } from "./buckets";

/**
 * État vide de `/tournois` (`docs/features/TOURNOIS_LIST_EMPTY_LOOK.md`) :
 *
 * - `empty` : aucune section à montrer, aucun filtre — le site n'a rien publié ;
 * - `filtered` : aucune section, mais une recherche ou un jeu choisi les a vidées ;
 * - `nothingUpcoming` : des sections, mais rien à rejoindre (ni inscriptions
 *   ouvertes, ni tournoi annoncé) — la page ne s'arrête plus sur un grand vide
 *   sous une ou deux cartes ;
 * - `pending` : aucune section, mais une recherche attend encore l'archive des
 *   terminés (`searchAwaitsArchive`) — « Aucun résultat » y serait annoncé à
 *   tort avant que les vrais résultats n'arrivent : la page dit qu'elle charge ;
 * - `null` : rien à dire (liste pas encore lue, ou de quoi s'inscrire).
 *
 * Une recherche tapée ne donne jamais `nothingUpcoming` : son résultat répond
 * déjà, et « aucun tournoi à venir » y serait faux. Un jeu choisi, lui, le
 * garde : « rien à venir en Marvel Rivals » reste vrai.
 */
export type ListEmptyKind = "empty" | "filtered" | "nothingUpcoming";

/** Ce que la page montre à la place des sections : un panneau, l'attente, ou rien. */
export type ListEmptyOutcome = ListEmptyKind | "pending" | null;

/**
 * Une recherche attend-elle encore l'archive des terminés ? Seule une recherche
 * tapée peut viser un terminé que la liste courte ne porte pas : sans elle, les
 * comptes de l'archive (`finishedTotals`, servis avec la liste courte) disent
 * déjà combien il y en a, par jeu compris — rien à attendre. Une archive en
 * échec n'est plus attendue : la page tranche avec ce qu'elle a, au lieu de
 * rester sur « Chargement… » jusqu'à la relecture suivante.
 */
export function searchAwaitsArchive({
  archiveWanted,
  listTruncated,
  archiveFailed,
  query,
}: Readonly<{
  /** L'archive entière est demandée (`needsFinishedArchive`). */
  archiveWanted: boolean;
  /** La liste en main est encore la liste courte (`finishedTotals` présent). */
  listTruncated: boolean;
  /** La dernière lecture de l'archive a échoué. */
  archiveFailed: boolean;
  query: string;
}>): boolean {
  return archiveWanted && listTruncated && !archiveFailed && query.trim() !== "";
}

export function listEmptyKind({
  loaded,
  shownSections,
  upcomingCount,
  query,
  gameFilter,
  archivePending = false,
}: Readonly<{
  /** La porte d'affichage est ouverte (première liste lue). */
  loaded: boolean;
  /** Nombre de sections rendues (compte > 0). */
  shownSections: number;
  /** Inscriptions ouvertes + tournois annoncés, « Mes tournois » et invisibles (staff) compris. */
  upcomingCount: number;
  query: string;
  gameFilter: GameFilter;
  /** Une recherche attend encore l'archive des terminés (`searchAwaitsArchive`). */
  archivePending?: boolean;
}>): ListEmptyOutcome {
  if (!loaded) return null;
  if (shownSections === 0) {
    if (!hasActiveFilter(query, gameFilter)) return "empty";
    return archivePending ? "pending" : "filtered";
  }
  if (upcomingCount === 0 && query.trim() === "") return "nothingUpcoming";
  return null;
}
