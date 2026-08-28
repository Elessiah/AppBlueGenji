import { describe, expect, it } from "@jest/globals";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { nextBucketsChangeAt, rescheduleBuckets } from "@/lib/shared/tournament-schedule";

const OPEN = Date.parse("2026-06-01T18:00:00Z");
const CLOSE = Date.parse("2026-06-01T19:00:00Z");
const START = Date.parse("2026-06-01T20:00:00Z");

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
    registrationOpenAt: new Date(OPEN).toISOString(),
    registrationCloseAt: new Date(CLOSE).toISOString(),
    startAt: new Date(START).toISOString(),
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

describe("rescheduleBuckets", () => {
  it("laisse les paniers en place tant que rien n'a bougé", () => {
    const source = buckets({ upcoming: [card()] });
    const result = rescheduleBuckets(source, OPEN - 60_000);

    expect(result.upcoming).toHaveLength(1);
    expect(result.registration).toHaveLength(0);
    // Aucune copie inutile quand l'état est déjà le bon.
    expect(result.upcoming[0]).toBe(source.upcoming[0]);
  });

  it("fait passer un tournoi aux inscriptions à l'heure dite", () => {
    const result = rescheduleBuckets(buckets({ upcoming: [card()] }), OPEN);

    expect(result.upcoming).toHaveLength(0);
    expect(result.registration).toHaveLength(1);
    // La pastille affichée suit le panier : sinon la carte dirait « Prochainement »
    // au milieu de la section « Inscriptions ».
    expect(result.registration[0].state).toBe("REGISTRATION");
  });

  it("fait démarrer un tournoi à son heure de début", () => {
    const result = rescheduleBuckets(
      buckets({ registration: [card({ state: "REGISTRATION" })] }),
      START,
    );

    expect(result.running).toHaveLength(1);
    expect(result.running[0].state).toBe("RUNNING");
  });

  it("ne ressuscite jamais un tournoi terminé", () => {
    const result = rescheduleBuckets(
      buckets({ finished: [card({ state: "FINISHED" })] }),
      OPEN,
    );

    expect(result.finished).toHaveLength(1);
    expect(result.registration).toHaveLength(0);
  });

  it("reconstitue l'ordre du serveur, début décroissant", () => {
    const early = card({ id: 1, startAt: "2026-06-01T10:00:00Z" });
    const late = card({ id: 2, startAt: "2026-06-03T10:00:00Z" });
    const middle = card({ id: 3, startAt: "2026-06-02T10:00:00Z" });

    // Les trois basculent ensemble : ils doivent arriver triés, pas dans
    // l'ordre où les paniers d'origine les portaient.
    const result = rescheduleBuckets(
      buckets({ upcoming: [early, middle], registration: [late] }),
      OPEN,
    );

    expect(result.registration.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("ne perd aucun tournoi au passage", () => {
    const source = buckets({
      upcoming: [card({ id: 1 })],
      registration: [card({ id: 2, state: "REGISTRATION" })],
      running: [card({ id: 3, state: "RUNNING" })],
      finished: [card({ id: 4, state: "FINISHED" })],
    });
    const result = rescheduleBuckets(source, START + 1_000);

    const ids = [
      ...result.upcoming,
      ...result.registration,
      ...result.running,
      ...result.finished,
    ].map((c) => c.id);
    expect(ids.sort()).toEqual([1, 2, 3, 4]);
  });

  it("accepte des paniers vides", () => {
    expect(rescheduleBuckets(buckets(), OPEN)).toEqual(buckets());
  });
});

describe("nextBucketsChangeAt", () => {
  it("retient la bascule la plus proche de toute la page", () => {
    const soon = card({ id: 1, registrationOpenAt: new Date(OPEN).toISOString() });
    const later = card({
      id: 2,
      registrationOpenAt: new Date(OPEN + 3_600_000).toISOString(),
      registrationCloseAt: new Date(CLOSE + 3_600_000).toISOString(),
      startAt: new Date(START + 3_600_000).toISOString(),
    });

    expect(nextBucketsChangeAt(buckets({ upcoming: [soon, later] }), OPEN - 1)).toBe(OPEN);
  });

  it("ne rend rien quand plus rien ne doit bouger", () => {
    const done = card({ state: "FINISHED" });
    const running = card({ id: 2, state: "RUNNING" });

    expect(
      nextBucketsChangeAt(buckets({ finished: [done], running: [running] }), START + 1),
    ).toBeNull();
  });

  it("ne rend rien sur une page vide", () => {
    expect(nextBucketsChangeAt(buckets(), OPEN)).toBeNull();
  });

  it("ignore les tournois terminés dans le calcul", () => {
    // Un tournoi terminé ne doit pas provoquer de réveil, même si ses dates
    // d'inscription sont dans le futur (cas d'une clôture anticipée).
    const done = card({
      state: "FINISHED",
      registrationOpenAt: new Date(OPEN + 10_000).toISOString(),
    });
    expect(nextBucketsChangeAt(buckets({ finished: [done] }), OPEN)).toBeNull();
  });
});
