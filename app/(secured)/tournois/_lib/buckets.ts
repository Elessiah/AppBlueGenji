import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

export type GameFilter = "all" | "ow2" | "mr";

export function filterTournamentsByQuery(tournaments: TournamentCard[], query: string): TournamentCard[] {
  if (!query) return tournaments;
  const lowerQuery = query.toLowerCase();
  return tournaments.filter((t) => {
    const nameMatch = t.name.toLowerCase().includes(lowerQuery);
    const descMatch = (t.description || "").toLowerCase().includes(lowerQuery);
    return nameMatch || descMatch;
  });
}

export function filterTournamentsByGame(tournaments: TournamentCard[], gameFilter: GameFilter): TournamentCard[] {
  if (gameFilter === "all") return tournaments;
  if (gameFilter === "ow2") return tournaments.filter((t) => t.game === "OW2");
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
  if (gameFilter === "ow2") return allTournaments.filter((t) => t.game === "OW2").length;
  if (gameFilter === "mr") return allTournaments.filter((t) => t.game === "MR").length;
  return 0;
}
