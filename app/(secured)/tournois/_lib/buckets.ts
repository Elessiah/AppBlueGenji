import { formatLabel } from "@/lib/shared/tournament-labels";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

export type GameFilter = "all" | "ow" | "mr";

/**
 * Nom, description et **format** (« ronde suisse », « survie »… au lieu du
 * code `SWISS`) : c'est tout ce qu'une carte annonce sans requête à part —
 * les équipes engagées n'y figurent pas, une recherche ne les couvre donc
 * pas non plus. Par `formatLabel`, qui retombe sur la valeur brute plutôt que
 * de lever — `TournamentCard.format` n'est typé qu'à la compilation, une
 * réponse JSON ne le garantit pas à l'exécution, et un format que
 * `FORMAT_LABELS` ignorerait encore ferait planter toute la page à la
 * première recherche.
 */
export function filterTournamentsByQuery(tournaments: TournamentCard[], query: string): TournamentCard[] {
  const trimmed = query.trim();
  if (!trimmed) return tournaments;
  const lowerQuery = trimmed.toLowerCase();
  return tournaments.filter((t) => {
    const nameMatch = t.name.toLowerCase().includes(lowerQuery);
    const descMatch = (t.description || "").toLowerCase().includes(lowerQuery);
    const formatMatch = formatLabel(t.format).toLowerCase().includes(lowerQuery);
    return nameMatch || descMatch || formatMatch;
  });
}

export function filterTournamentsByGame(tournaments: TournamentCard[], gameFilter: GameFilter): TournamentCard[] {
  if (gameFilter === "all") return tournaments;
  if (gameFilter === "ow") return tournaments.filter((t) => t.game === "OW");
  if (gameFilter === "mr") return tournaments.filter((t) => t.game === "MR");
  return tournaments;
}

export function filterBuckets(
  buckets: TournamentBuckets,
  query: string,
  gameFilter: GameFilter
): TournamentBuckets {
  const filterTournaments = (tournaments: TournamentCard[]) =>
    filterTournamentsByGame(filterTournamentsByQuery(tournaments, query), gameFilter);

  return {
    upcoming: filterTournaments(buckets.upcoming),
    registration: filterTournaments(buckets.registration),
    running: filterTournaments(buckets.running),
    finished: filterTournaments(buckets.finished),
  };
}

/**
 * Remet les quatre paniers à plat, dans l'ordre de lecture de la page (en
 * cours, inscriptions, à venir, terminés). Sert à la section « invisibles »,
 * qui rassemble des tournois de n'importe quel état.
 */
export function flattenBuckets(buckets: TournamentBuckets): TournamentCard[] {
  return [...buckets.running, ...buckets.registration, ...buckets.upcoming, ...buckets.finished];
}

export function countByGame(buckets: TournamentBuckets, gameFilter: GameFilter): number {
  const allTournaments = flattenBuckets(buckets);
  if (gameFilter === "all") return allTournaments.length;
  if (gameFilter === "ow") return allTournaments.filter((t) => t.game === "OW").length;
  if (gameFilter === "mr") return allTournaments.filter((t) => t.game === "MR").length;
  return 0;
}

/**
 * Libellé du raccourci de la recherche, selon la plateforme : « ⌘K »
 * n'existe que sur un clavier Apple, `Ctrl+K` fonctionne partout ailleurs
 * (Windows, Linux) — y compris là où le raccourci était pourtant affiché en
 * `⌘K`. Prend une chaîne de plateforme (`navigator.platform` ou, à défaut,
 * `navigator.userAgent`) plutôt que de lire `navigator` elle-même, pour
 * rester testable sans DOM.
 */
export function searchShortcutLabel(platform: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl+K";
}

/** Un filtre (recherche ou pastille de jeu) change ce qu'une section vide veut dire. */
export function hasActiveFilter(query: string, gameFilter: GameFilter): boolean {
  return query.trim() !== "" || gameFilter !== "all";
}

/**
 * Message d'une section vide : une section réellement sans tournoi ne dit pas
 * la même chose qu'une section que le filtre en cours a vidée — la seconde
 * doit pousser à changer de recherche, pas laisser croire qu'il n'y a
 * vraiment rien.
 */
export function sectionEmptyMessage(whenUnfiltered: string, query: string, gameFilter: GameFilter): string {
  return hasActiveFilter(query, gameFilter) ? "Aucun résultat pour cette recherche." : whenUnfiltered;
}
