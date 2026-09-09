import { describe, expect, it } from "@jest/globals";
import {
  activeTournamentCards,
  chooseFeaturedTournament,
  inferGameCode,
  inferGameLabel,
  inferGameShortLabel,
} from "@/lib/shared/landing";
import type { TournamentBuckets, TournamentCard, TournamentState } from "@/lib/shared/types";

describe("inferGameLabel", () => {
  it("detects Marvel Rivals from either keyword", () => {
    expect(inferGameLabel("Marvel Rivals Open")).toBe("Marvel Rivals");
    expect(inferGameLabel("Rivals Winter Cup")).toBe("Marvel Rivals");
  });

  it("is case-insensitive", () => {
    expect(inferGameLabel("MARVEL RIVALS PRO SERIES")).toBe("Marvel Rivals");
  });

  it("falls back to Overwatch for anything else", () => {
    expect(inferGameLabel("OW Spring Clash")).toBe("Overwatch");
    expect(inferGameLabel("Genji Clash #14")).toBe("Overwatch");
  });

  it("tolerates null and undefined", () => {
    expect(inferGameLabel(null)).toBe("Overwatch");
    expect(inferGameLabel(undefined)).toBe("Overwatch");
    expect(inferGameLabel("")).toBe("Overwatch");
  });
});

describe("inferGameCode", () => {
  it("maps to the filter keys used by the landing endpoints", () => {
    expect(inferGameCode("Marvel Rivals Cup S1")).toBe("mr");
    expect(inferGameCode("OW Champions League")).toBe("ow2");
    expect(inferGameCode(null)).toBe("ow2");
  });
});

describe("inferGameShortLabel", () => {
  it("abbreviates the label for narrow pills", () => {
    expect(inferGameShortLabel("Marvel Rivals Open")).toBe("MR");
    expect(inferGameShortLabel("OW Winter Cup")).toBe("OW");
  });

  it("stays aligned with inferGameLabel", () => {
    for (const name of ["Marvel Rivals Open", "Genji Clash", "", null]) {
      const expected = inferGameLabel(name) === "Marvel Rivals" ? "MR" : "OW";
      expect(inferGameShortLabel(name)).toBe(expected);
    }
  });
});

function card(id: number, state: TournamentState): TournamentCard {
  return {
    id,
    name: `Tournoi ${id}`,
    description: null,
    format: "SINGLE",
    game: "OVERWATCH",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 4,
    state,
    startVisibilityAt: "2026-01-01T00:00:00.000Z",
    registrationOpenAt: "2026-01-02T00:00:00.000Z",
    registrationCloseAt: "2026-01-03T00:00:00.000Z",
    startAt: "2026-01-04T00:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    endurancePlayoffFormat: null,
    liveUrl: null,
  };
}

function buckets(partial: Partial<TournamentBuckets>): TournamentBuckets {
  return { upcoming: [], registration: [], running: [], finished: [], ...partial };
}

describe("activeTournamentCards", () => {
  it("laisse dehors les tournois terminés", () => {
    const list = activeTournamentCards(
      buckets({
        running: [card(1, "RUNNING")],
        upcoming: [card(2, "UPCOMING")],
        registration: [card(3, "REGISTRATION")],
        finished: [card(4, "FINISHED")],
      }),
    );

    expect(list.map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("range ce qui se joue maintenant en tête, puis à venir, puis inscriptions", () => {
    const list = activeTournamentCards(
      buckets({
        upcoming: [card(20, "UPCOMING"), card(21, "UPCOMING")],
        registration: [card(30, "REGISTRATION")],
        running: [card(10, "RUNNING")],
      }),
    );

    expect(list.map((entry) => entry.id)).toEqual([10, 20, 21, 30]);
  });

  it("ne rend rien quand seuls des tournois terminés existent", () => {
    expect(activeTournamentCards(buckets({ finished: [card(9, "FINISHED")] }))).toEqual([]);
  });
});

describe("chooseFeaturedTournament", () => {
  it("préfère un tournoi à venir : le hero décompte jusqu'à son coup d'envoi", () => {
    const featured = chooseFeaturedTournament(
      buckets({
        running: [card(10, "RUNNING")],
        registration: [card(30, "REGISTRATION")],
        upcoming: [card(20, "UPCOMING")],
      }),
    );

    expect(featured?.id).toBe(20);
  });

  it("retombe sur les inscriptions puis sur un tournoi en cours", () => {
    expect(
      chooseFeaturedTournament(buckets({ registration: [card(30, "REGISTRATION")], running: [card(10, "RUNNING")] }))?.id,
    ).toBe(30);
    expect(chooseFeaturedTournament(buckets({ running: [card(10, "RUNNING")] }))?.id).toBe(10);
  });

  it("ne repêche jamais une archive : rien de visible rend null", () => {
    expect(chooseFeaturedTournament(buckets({ finished: [card(4, "FINISHED")] }))).toBeNull();
    expect(chooseFeaturedTournament(buckets({}))).toBeNull();
  });
});
