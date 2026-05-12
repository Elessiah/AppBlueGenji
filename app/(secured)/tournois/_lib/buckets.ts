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

export function countByGame(buckets: TournamentBuckets, gameFilter: GameFilter): number {
  const allTournaments = [...buckets.upcoming, ...buckets.registration, ...buckets.running, ...buckets.finished];
  if (gameFilter === "all") return allTournaments.length;
  if (gameFilter === "ow2") return allTournaments.filter((t) => t.game === "OW2").length;
  if (gameFilter === "mr") return allTournaments.filter((t) => t.game === "MR").length;
  return 0;
}
