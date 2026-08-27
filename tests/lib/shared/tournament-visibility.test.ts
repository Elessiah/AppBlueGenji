import { describe, expect, it } from "@jest/globals";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import {
  isTournamentHidden,
  splitHiddenTournaments,
} from "@/lib/shared/tournament-visibility";

const NOW = Date.parse("2026-06-01T12:00:00Z");

const card = (overrides: Partial<TournamentCard> = {}): TournamentCard =>
  ({
    id: 1,
    name: "Tournoi",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 0,
    state: "UPCOMING",
    startVisibilityAt: "2026-05-01T12:00:00Z",
    registrationOpenAt: "2026-05-02T12:00:00Z",
    registrationCloseAt: "2026-05-03T12:00:00Z",
    startAt: "2026-05-04T12:00:00Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    ...overrides,
  }) as TournamentCard;

const buckets = (overrides: Partial<TournamentBuckets> = {}): TournamentBuckets => ({
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
  ...overrides,
});

describe("isTournamentHidden", () => {
  it("masque un tournoi dont la visibilité est encore à venir", () => {
    expect(isTournamentHidden(card({ startVisibilityAt: "2026-07-01T00:00:00Z" }), NOW)).toBe(true);
  });

  it("montre un tournoi dont la visibilité est passée", () => {
    expect(isTournamentHidden(card({ startVisibilityAt: "2026-05-01T00:00:00Z" }), NOW)).toBe(false);
  });

  it("montre un tournoi à la seconde exacte de sa visibilité", () => {
    expect(isTournamentHidden(card({ startVisibilityAt: "2026-06-01T12:00:00Z" }), NOW)).toBe(false);
  });

  it("masque un tournoi une milliseconde avant sa visibilité", () => {
    expect(isTournamentHidden(card({ startVisibilityAt: "2026-06-01T12:00:00.001Z" }), NOW)).toBe(
      true,
    );
  });

  it("traite une date illisible comme visible plutôt que de la faire disparaître", () => {
    expect(isTournamentHidden(card({ startVisibilityAt: "pas une date" }), NOW)).toBe(false);
    expect(isTournamentHidden(card({ startVisibilityAt: "" }), NOW)).toBe(false);
  });

  it("se rabat sur l'heure courante sans repère explicite", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isTournamentHidden(card({ startVisibilityAt: past }))).toBe(false);
    expect(isTournamentHidden(card({ startVisibilityAt: future }))).toBe(true);
  });
});

describe("splitHiddenTournaments", () => {
  it("laisse les paniers intacts quand tout est visible", () => {
    const input = buckets({
      upcoming: [card({ id: 1 })],
      running: [card({ id: 2, state: "RUNNING" })],
    });

    const { hidden, visible } = splitHiddenTournaments(input, NOW);

    expect(hidden).toEqual([]);
    expect(visible.upcoming.map((t) => t.id)).toEqual([1]);
    expect(visible.running.map((t) => t.id)).toEqual([2]);
  });

  it("sort les masqués de leur panier d'état", () => {
    const input = buckets({
      upcoming: [
        card({ id: 1 }),
        card({ id: 2, startVisibilityAt: "2026-07-01T00:00:00Z" }),
        card({ id: 3 }),
      ],
    });

    const { hidden, visible } = splitHiddenTournaments(input, NOW);

    expect(hidden.map((t) => t.id)).toEqual([2]);
    expect(visible.upcoming.map((t) => t.id)).toEqual([1, 3]);
  });

  it("récolte les masqués de tous les états, dans l'ordre des paniers", () => {
    const masked = "2026-07-01T00:00:00Z";
    const input = buckets({
      upcoming: [card({ id: 3, startVisibilityAt: masked })],
      registration: [card({ id: 2, state: "REGISTRATION", startVisibilityAt: masked })],
      running: [card({ id: 1, state: "RUNNING", startVisibilityAt: masked })],
      finished: [card({ id: 4, state: "FINISHED", startVisibilityAt: masked })],
    });

    const { hidden, visible } = splitHiddenTournaments(input, NOW);

    expect(hidden.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(visible).toEqual(buckets());
  });

  it("préserve l'ordre interne de chaque panier", () => {
    const input = buckets({
      finished: [card({ id: 9 }), card({ id: 5 }), card({ id: 7 })],
    });

    const { visible } = splitHiddenTournaments(input, NOW);

    expect(visible.finished.map((t) => t.id)).toEqual([9, 5, 7]);
  });

  it("ne modifie pas les paniers reçus", () => {
    const input = buckets({
      upcoming: [card({ id: 1, startVisibilityAt: "2026-07-01T00:00:00Z" })],
    });

    splitHiddenTournaments(input, NOW);

    expect(input.upcoming).toHaveLength(1);
  });

  it("supporte des paniers vides", () => {
    const { hidden, visible } = splitHiddenTournaments(buckets(), NOW);
    expect(hidden).toEqual([]);
    expect(visible).toEqual(buckets());
  });
});
