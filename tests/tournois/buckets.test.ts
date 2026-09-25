import { describe, it, expect } from "@jest/globals";
import type { TournamentCard, TournamentBuckets } from "@/lib/shared/types";
import {
  filterTournamentsByQuery,
  filterTournamentsByGame,
  filterBuckets,
  flattenBuckets,
  countByGame,
  searchShortcutLabel,
  hasActiveFilter,
  sectionEmptyMessage,
} from "@/app/(secured)/tournois/_lib/buckets";
import { tournamentCard } from "../helpers/tournament-card";

const mockCard = (overrides?: Partial<TournamentCard>): TournamentCard =>
  tournamentCard({
    name: "Test Tournament",
    description: "A test tournament",
    startAt: "2026-05-20T10:00:00Z",
    registeredTeams: 4,
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

    it("filters tournaments by format label", () => {
      const cards = [
        mockCard({ name: "Alpha", format: "SWISS" }),
        mockCard({ name: "Beta", format: "SINGLE" }),
      ];
      const result = filterTournamentsByQuery(cards, "suisse");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Alpha");
    });
  });

  describe("filterTournamentsByGame", () => {
    it("returns all tournaments when gameFilter is 'all'", () => {
      const cards = [mockCard({ game: "OW" }), mockCard({ game: "MR" })];
      const result = filterTournamentsByGame(cards, "all");
      expect(result).toEqual(cards);
    });

    it("filters tournaments by OW game", () => {
      const cards = [mockCard({ game: "OW" }), mockCard({ game: "MR" })];
      const result = filterTournamentsByGame(cards, "ow");
      expect(result).toHaveLength(1);
      expect(result[0].game).toBe("OW");
    });

    it("filters tournaments by MR game", () => {
      const cards = [mockCard({ game: "OW" }), mockCard({ game: "MR" })];
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
          mockCard({ name: "OW Championship", game: "OW" }),
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
          mockCard({ name: "Marvel OW", game: "OW" }),
        ],
      });
      const result = filterBuckets(buckets, "marvel", "ow");
      expect(result.registration).toHaveLength(1);
      expect(result.registration[0].game).toBe("OW");
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

    it("counts OW tournaments", () => {
      const buckets = mockBuckets({
        upcoming: [mockCard({ game: "OW" }), mockCard({ game: "MR" })],
        registration: [mockCard({ game: "OW" })],
      });
      const result = countByGame(buckets, "ow");
      expect(result).toBe(2);
    });

    it("counts MR tournaments", () => {
      const buckets = mockBuckets({
        upcoming: [mockCard({ game: "MR" }), mockCard({ game: "OW" })],
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

describe("flattenBuckets", () => {
  it("remet les quatre paniers à plat dans l'ordre de lecture de la page", () => {
    const result = flattenBuckets(
      mockBuckets({
        upcoming: [mockCard({ id: 3 })],
        registration: [mockCard({ id: 2 })],
        running: [mockCard({ id: 1 })],
        finished: [mockCard({ id: 4 })],
      }),
    );

    expect(result.map((t) => t.id)).toEqual([1, 2, 3, 4]);
  });

  it("préserve l'ordre interne de chaque panier", () => {
    const result = flattenBuckets(
      mockBuckets({ finished: [mockCard({ id: 9 }), mockCard({ id: 5 })] }),
    );

    expect(result.map((t) => t.id)).toEqual([9, 5]);
  });

  it("renvoie une liste vide pour des paniers vides", () => {
    expect(flattenBuckets(mockBuckets())).toEqual([]);
  });
});

describe("searchShortcutLabel", () => {
  it("dit ⌘K sur un clavier Apple", () => {
    expect(searchShortcutLabel("MacIntel")).toBe("⌘K");
    expect(searchShortcutLabel("iPhone")).toBe("⌘K");
    expect(searchShortcutLabel("iPad")).toBe("⌘K");
  });

  it("dit Ctrl+K partout ailleurs, Windows compris", () => {
    expect(searchShortcutLabel("Win32")).toBe("Ctrl+K");
    expect(searchShortcutLabel("Linux x86_64")).toBe("Ctrl+K");
  });
});

describe("hasActiveFilter", () => {
  it("est faux sans recherche et sur le jeu « Tous »", () => {
    expect(hasActiveFilter("", "all")).toBe(false);
    expect(hasActiveFilter("   ", "all")).toBe(false);
  });

  it("est vrai dès qu'une recherche ou un jeu est choisi", () => {
    expect(hasActiveFilter("marvel", "all")).toBe(true);
    expect(hasActiveFilter("", "ow")).toBe(true);
  });
});

describe("sectionEmptyMessage", () => {
  it("garde le message d'origine sans filtre actif", () => {
    expect(sectionEmptyMessage("Aucun tournoi en cours actuellement.", "", "all")).toBe(
      "Aucun tournoi en cours actuellement.",
    );
  });

  it("dit qu'aucun résultat ne correspond dès qu'un filtre est actif", () => {
    expect(sectionEmptyMessage("Aucun tournoi en cours actuellement.", "marvel", "all")).toBe(
      "Aucun résultat pour cette recherche.",
    );
    expect(sectionEmptyMessage("Aucun tournoi en cours actuellement.", "", "mr")).toBe(
      "Aucun résultat pour cette recherche.",
    );
  });
});
