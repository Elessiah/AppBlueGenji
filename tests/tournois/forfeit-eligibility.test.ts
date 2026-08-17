import { describe, expect, it } from "@jest/globals";
import {
  canForfeitTeam,
  type ForfeitContext,
} from "@/app/(secured)/tournois/[id]/_lib/forfeit";

const MY_TEAM = 77;
const OTHER_TEAM = 88;

function context(overrides: Partial<ForfeitContext> = {}): ForfeitContext {
  return {
    format: "SURVIVAL",
    state: "RUNNING",
    isAdmin: false,
    myTeamId: MY_TEAM,
    canCreateReportsForTeamIds: [MY_TEAM],
    ...overrides,
  };
}

describe("forfait — éligibilité du bouton", () => {
  it("autorise un représentant à déclarer le forfait de son équipe", () => {
    expect(canForfeitTeam(context(), MY_TEAM)).toBe(true);
  });

  it("refuse à un représentant le forfait d'une autre équipe", () => {
    expect(canForfeitTeam(context(), OTHER_TEAM)).toBe(false);
  });

  it("refuse à un simple membre, qui ne représente pas l'équipe", () => {
    expect(canForfeitTeam(context({ canCreateReportsForTeamIds: [] }), MY_TEAM)).toBe(false);
  });

  it("refuse à un spectateur sans équipe", () => {
    expect(
      canForfeitTeam(context({ myTeamId: null, canCreateReportsForTeamIds: [] }), OTHER_TEAM),
    ).toBe(false);
  });

  it("autorise l'arbitrage sur n'importe quelle équipe", () => {
    const referee = context({ isAdmin: true, myTeamId: null, canCreateReportsForTeamIds: [] });
    expect(canForfeitTeam(referee, MY_TEAM)).toBe(true);
    expect(canForfeitTeam(referee, OTHER_TEAM)).toBe(true);
  });
});

describe("forfait — restrictions de contexte", () => {
  it("n'existe que dans un tournoi en cours", () => {
    for (const state of ["UPCOMING", "REGISTRATION", "FINISHED"] as const) {
      expect(canForfeitTeam(context({ state }), MY_TEAM)).toBe(false);
      // Même l'arbitrage ne peut pas forfaiter hors tournoi en cours
      expect(canForfeitTeam(context({ state, isAdmin: true }), MY_TEAM)).toBe(false);
    }
  });

  it("n'existe que dans les formats à classement (Survie, Ronde suisse)", () => {
    // En élimination, une équipe qui renonce perd son match : il n'y a rien à
    // abandonner en dehors du terrain.
    for (const format of ["SINGLE", "DOUBLE"] as const) {
      expect(canForfeitTeam(context({ format }), MY_TEAM)).toBe(false);
      expect(canForfeitTeam(context({ format, isAdmin: true }), MY_TEAM)).toBe(false);
    }
    for (const format of ["SURVIVAL", "SWISS"] as const) {
      expect(canForfeitTeam(context({ format }), MY_TEAM)).toBe(true);
      expect(canForfeitTeam(context({ format, isAdmin: true }), OTHER_TEAM)).toBe(true);
    }
  });
});
