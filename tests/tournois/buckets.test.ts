import { describe, it, expect } from "@jest/globals";
import type { TournamentCard, TournamentBuckets } from "@/lib/shared/types";
import {
  filterTournamentsByQuery,
  filterTournamentsByGame,
  filterBuckets,
  countByGame,
} from "@/app/(secured)/tournois/_lib/buckets";

const mockCard = (overrides?: Partial<TournamentCard>): TournamentCard => ({
  id: "1",
  name: "Test Tournament",
  description: "A test tournament",
  game: "OW2",
  state: "UPCOMING",
  startAt: "2026-05-20T10:00:00Z",
  registeredTeams: 4,
  maxTeams: 8,
  ...overrides,
});

const mockBuckets = (overrides?: Partial<TournamentBuckets>): TournamentBuckets => ({
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
  ...overrides,
});

describe("buckets", () => {
  describe("filterTournamentsByQuery", () => {
    it("returns all tournaments when query is empty", () => {
      const cards = [mockCard({ name: "Tournament A" }), mockCard({ name: "Tournament B" })];
      const result = filterTournamentsByQuery(cards, "");
      expect(result).toEqual(cards);
    });

    it("filters tournaments by name", () => {
      const cards = [mockCard({ name: "Marvel Rivals Cup" }), mockCard({ name: "Overwatch League" })];
      const result = filterTournamentsByQuery(cards, "marvel");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Marvel Rivals Cup");
    });

    it("filters tournaments by description", () => {
      const cards = [
        mockCard({ name: "Tournament A", description: "Qualifying round" }),
        mockCard({ name: "Tournament B", description: "Final event" }),
      ];
      const result = filterTournamentsByQuery(cards, "qualifying");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Tournament A");
    });

    it("is case-insensitive", () => {
      const cards = [mockCard({ name: "TOURNAMENT" })];
      const result = filterTournamentsByQuery(cards, "tournament");
      expect(result).toHaveLength(1);
    });
  });

  describe("filterTournamentsByGame", () => {
    it("returns all tournaments when gameFilter is 'all'", () => {
      const cards = [mockCard({ game: "OW2" }), mockCard({ game: "MR" })];
      const result = filterTournamentsByGame(cards, "all");
      expect(result).toEqual(cards);
    });

    it("filters tournaments by OW2 game", () => {
      const cards = [mockCard({ game: "OW2" }), mockCard({ game: "MR" })];
      const result = filterTournamentsByGame(cards, "ow2");
      expect(result).toHaveLength(1);
      expect(result[0].game).toBe("OW2");
    });

    it("filters tournaments by MR game", () => {
      const cards = [mockCard({ game: "OW2" }), mockCard({ game: "MR" })];
      const result = filterTournamentsByGame(cards, "mr");
      expect(result).toHaveLength(1);
      expect(result[0].game).toBe("MR");
    });
  });

  describe("filterBuckets", () => {
    it("filters buckets by query and game", () => {
      const buckets = mockBuckets({
        upcoming: [
          mockCard({ name: "Marvel Cup", game: "MR" }),
          mockCard({ name: "OW2 Championship", game: "OW2" }),
        ],
      });
      const result = filterBuckets(buckets, "marvel", "all");
      expect(result.upcoming).toHaveLength(1);
      expect(result.upcoming[0].name).toBe("Marvel Cup");
    });

    it("respects both query and game filter", () => {
      const buckets = mockBuckets({
        registration: [
          mockCard({ name: "Marvel Cup", game: "MR" }),
          mockCard({ name: "Marvel OW2", game: "OW2" }),
        ],
      });
      const result = filterBuckets(buckets, "marvel", "ow2");
      expect(result.registration).toHaveLength(1);
      expect(result.registration[0].game).toBe("OW2");
    });

    it("preserves all bucket categories", () => {
      const buckets = mockBuckets({
        upcoming: [mockCard()],
        registration: [mockCard()],
        running: [mockCard()],
        finished: [mockCard()],
      });
      const result = filterBuckets(buckets, "", "all");
      expect(result.upcoming).toHaveLength(1);
      expect(result.registration).toHaveLength(1);
      expect(result.running).toHaveLength(1);
      expect(result.finished).toHaveLength(1);
    });
  });

  describe("countByGame", () => {
    it("counts all tournaments when gameFilter is 'all'", () => {
      const buckets = mockBuckets({
        upcoming: [mockCard(), mockCard()],
        registration: [mockCard()],
        running: [],
        finished: [mockCard()],
      });
      const result = countByGame(buckets, "all");
      expect(result).toBe(4);
    });

    it("counts OW2 tournaments", () => {
      const buckets = mockBuckets({
        upcoming: [mockCard({ game: "OW2" }), mockCard({ game: "MR" })],
        registration: [mockCard({ game: "OW2" })],
      });
      const result = countByGame(buckets, "ow2");
      expect(result).toBe(2);
    });

    it("counts MR tournaments", () => {
      const buckets = mockBuckets({
        upcoming: [mockCard({ game: "MR" }), mockCard({ game: "OW2" })],
        finished: [mockCard({ game: "MR" })],
      });
      const result = countByGame(buckets, "mr");
      expect(result).toBe(2);
    });

    it("returns 0 for empty buckets", () => {
      const buckets = mockBuckets();
      const result = countByGame(buckets, "all");
      expect(result).toBe(0);
    });
  });
});
