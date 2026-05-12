import { describe, it, expect } from "@jest/globals";
import type { TournamentBuckets } from "@/lib/shared/types";
import { buildTickerItems } from "@/app/(secured)/tournois/_lib/ticker";

const mockBuckets = (overrides?: Partial<TournamentBuckets>): TournamentBuckets => ({
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
  ...overrides,
});

describe("ticker", () => {
  describe("buildTickerItems", () => {
    it("returns empty message when buckets are empty", () => {
      const buckets = mockBuckets();
      const result = buildTickerItems(buckets);
      expect(result).toEqual(["Aucune actualité tournoi pour le moment"]);
    });

    it("includes running tournaments", () => {
      const buckets = mockBuckets({
        running: [
          {
            id: "1",
            name: "Championship",
            description: "",
            game: "OW2",
            state: "RUNNING",
            startAt: "2026-05-12T10:00:00Z",
            registeredTeams: 8,
            maxTeams: 8,
          },
        ],
      });
      const result = buildTickerItems(buckets);
      expect(result[0]).toContain("RÉSULTAT");
      expect(result[0]).toContain("Championship");
      expect(result[0]).toContain("8 équipes engagées");
    });

    it("includes up to 3 registration tournaments", () => {
      const buckets = mockBuckets({
        registration: [
          {
            id: "1",
            name: "Cup 1",
            description: "",
            game: "MR",
            state: "REGISTRATION",
            startAt: "2026-05-20T10:00:00Z",
            registeredTeams: 4,
            maxTeams: 8,
          },
          {
            id: "2",
            name: "Cup 2",
            description: "",
            game: "OW2",
            state: "REGISTRATION",
            startAt: "2026-05-21T10:00:00Z",
            registeredTeams: 6,
            maxTeams: 8,
          },
          {
            id: "3",
            name: "Cup 3",
            description: "",
            game: "MR",
            state: "REGISTRATION",
            startAt: "2026-05-22T10:00:00Z",
            registeredTeams: 5,
            maxTeams: 8,
          },
          {
            id: "4",
            name: "Cup 4",
            description: "",
            game: "OW2",
            state: "REGISTRATION",
            startAt: "2026-05-23T10:00:00Z",
            registeredTeams: 3,
            maxTeams: 8,
          },
        ],
      });
      const result = buildTickerItems(buckets);
      const registrationItems = result.filter((item) => item.includes("INSCRIPTIONS"));
      expect(registrationItems).toHaveLength(3);
      expect(registrationItems[0]).toContain("Cup 1");
      expect(registrationItems[1]).toContain("Cup 2");
      expect(registrationItems[2]).toContain("Cup 3");
    });

    it("includes up to 2 upcoming tournaments", () => {
      const buckets = mockBuckets({
        upcoming: [
          {
            id: "1",
            name: "Future Cup 1",
            description: "",
            game: "MR",
            state: "UPCOMING",
            startAt: "2026-05-25T10:00:00Z",
            registeredTeams: 0,
            maxTeams: 8,
          },
          {
            id: "2",
            name: "Future Cup 2",
            description: "",
            game: "OW2",
            state: "UPCOMING",
            startAt: "2026-05-26T10:00:00Z",
            registeredTeams: 0,
            maxTeams: 8,
          },
          {
            id: "3",
            name: "Future Cup 3",
            description: "",
            game: "MR",
            state: "UPCOMING",
            startAt: "2026-05-27T10:00:00Z",
            registeredTeams: 0,
            maxTeams: 8,
          },
        ],
      });
      const result = buildTickerItems(buckets);
      const upcomingItems = result.filter((item) => item.includes("À VENIR"));
      expect(upcomingItems).toHaveLength(2);
      expect(upcomingItems[0]).toContain("Future Cup 1");
      expect(upcomingItems[1]).toContain("Future Cup 2");
    });

    it("does not include finished tournaments", () => {
      const buckets = mockBuckets({
        finished: [
          {
            id: "1",
            name: "Old Cup",
            description: "",
            game: "OW2",
            state: "FINISHED",
            startAt: "2026-05-01T10:00:00Z",
            registeredTeams: 8,
            maxTeams: 8,
          },
        ],
      });
      const result = buildTickerItems(buckets);
      expect(result).toEqual(["Aucune actualité tournoi pour le moment"]);
    });

    it("combines all relevant tournaments in correct order", () => {
      const buckets = mockBuckets({
        running: [
          {
            id: "1",
            name: "Live Tournament",
            description: "",
            game: "OW2",
            state: "RUNNING",
            startAt: "2026-05-12T10:00:00Z",
            registeredTeams: 8,
            maxTeams: 8,
          },
        ],
        registration: [
          {
            id: "2",
            name: "Signup Tournament",
            description: "",
            game: "MR",
            state: "REGISTRATION",
            startAt: "2026-05-20T10:00:00Z",
            registeredTeams: 4,
            maxTeams: 8,
          },
        ],
        upcoming: [
          {
            id: "3",
            name: "Future Tournament",
            description: "",
            game: "OW2",
            state: "UPCOMING",
            startAt: "2026-05-25T10:00:00Z",
            registeredTeams: 0,
            maxTeams: 8,
          },
        ],
      });
      const result = buildTickerItems(buckets);
      expect(result.length).toBe(3);
      expect(result[0]).toContain("RÉSULTAT");
      expect(result[1]).toContain("INSCRIPTIONS");
      expect(result[2]).toContain("À VENIR");
    });
  });
});
