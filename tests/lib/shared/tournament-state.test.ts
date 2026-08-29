import { describe, expect, it } from "@jest/globals";
import {
  computeTournamentState,
  nextTournamentStateChangeAt,
  type TournamentStateInput,
} from "@/lib/shared/tournament-state";

const OPEN = Date.parse("2026-06-01T18:00:00Z");
const CLOSE = Date.parse("2026-06-01T19:00:00Z");
const START = Date.parse("2026-06-01T20:00:00Z");

const input = (overrides: Partial<TournamentStateInput> = {}): TournamentStateInput => ({
  state: "UPCOMING",
  registrationOpenAt: new Date(OPEN).toISOString(),
  registrationCloseAt: new Date(CLOSE).toISOString(),
  startAt: new Date(START).toISOString(),
  ...overrides,
});

describe("computeTournamentState", () => {
  it("annonce « prochainement » avant l'ouverture", () => {
    expect(computeTournamentState(input(), OPEN - 1)).toBe("UPCOMING");
  });

  it("ouvre les inscriptions à la milliseconde exacte", () => {
    expect(computeTournamentState(input(), OPEN)).toBe("REGISTRATION");
  });

  it("garde les inscriptions ouvertes jusqu'à la clôture incluse", () => {
    expect(computeTournamentState(input(), CLOSE)).toBe("REGISTRATION");
    expect(computeTournamentState(input(), CLOSE + 1)).toBe("UPCOMING");
  });

  it("revient à « prochainement » entre la clôture et le début", () => {
    // Les inscriptions sont closes mais rien n'a commencé : ce n'est ni l'un ni
    // l'autre, et l'affichage doit le dire.
    expect(computeTournamentState(input(), CLOSE + 60_000)).toBe("UPCOMING");
  });

  it("lance le tournoi à l'heure de début", () => {
    expect(computeTournamentState(input(), START)).toBe("RUNNING");
    expect(computeTournamentState(input(), START + 3_600_000)).toBe("RUNNING");
  });

  it("laisse un tournoi terminé terminé", () => {
    expect(computeTournamentState(input({ state: "FINISHED" }), OPEN - 1)).toBe("FINISHED");
    expect(
      computeTournamentState(input({ finishedAt: new Date(START).toISOString() }), OPEN - 1),
    ).toBe("FINISHED");
  });

  it("accepte indifféremment des dates ou des chaînes", () => {
    const asDates = input({
      registrationOpenAt: new Date(OPEN),
      registrationCloseAt: new Date(CLOSE),
      startAt: new Date(START),
    });
    expect(computeTournamentState(asDates, OPEN + 1)).toBe("REGISTRATION");
  });
});

describe("nextTournamentStateChangeAt", () => {
  it("vise l'ouverture des inscriptions depuis « prochainement »", () => {
    expect(nextTournamentStateChangeAt(input(), OPEN - 10_000)).toBe(OPEN);
  });

  it("vise la sortie des inscriptions, une milliseconde après la clôture", () => {
    // La clôture elle-même est encore ouverte : le changement se joue juste
    // après, sans quoi le minuteur se réveillerait pour rien.
    expect(nextTournamentStateChangeAt(input({ state: "REGISTRATION" }), OPEN + 1)).toBe(CLOSE + 1);
  });

  it("vise le début depuis l'entre-deux", () => {
    expect(nextTournamentStateChangeAt(input(), CLOSE + 2)).toBe(START);
  });

  it("ne promet plus rien une fois le tournoi lancé", () => {
    expect(nextTournamentStateChangeAt(input({ state: "RUNNING" }), START + 1)).toBeNull();
  });

  it("ne promet rien pour un tournoi terminé", () => {
    expect(nextTournamentStateChangeAt(input({ state: "FINISHED" }), OPEN - 1)).toBeNull();
  });

  it("saute une étape qui ne change rien à l'état", () => {
    // Inscriptions closes à l'instant même du départ. L'heure de début n'est
    // pas une bascule : les inscriptions y sont encore ouvertes (clôture
    // incluse). Le passage en RUNNING se joue une milliseconde plus tard, et
    // c'est ce réveil-là qu'il faut programmer — pas celui de `startAt`.
    const instant = input({
      state: "REGISTRATION",
      registrationCloseAt: new Date(START).toISOString(),
    });
    expect(nextTournamentStateChangeAt(instant, OPEN + 1)).toBe(START + 1);
  });

  it("ignore une date illisible plutôt que de rendre NaN", () => {
    // Une date invalide figerait le minuteur du client sur `NaN`. Ici la
    // clôture est illisible : les inscriptions ne s'ouvrent donc jamais, et la
    // seule bascule qui reste est le début du tournoi.
    const broken = input({ registrationCloseAt: "pas-une-date" });
    expect(nextTournamentStateChangeAt(broken, OPEN - 10_000)).toBe(START);
    expect(computeTournamentState(broken, OPEN + 1)).toBe("UPCOMING");
  });

  it("renvoie toujours un instant strictement futur", () => {
    const next = nextTournamentStateChangeAt(input(), OPEN);
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(OPEN);
  });
});
