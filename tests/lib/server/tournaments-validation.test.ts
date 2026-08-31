import { describe, expect, it } from "@jest/globals";
import {
  validateDateOrder,
  validateTournamentInput,
} from "@/lib/server/tournaments/validation";

const base = {
  name: "Coupe test",
  game: "OW2" as const,
  format: "SINGLE" as const,
  maxTeams: 16,
};

function value(input: Parameters<typeof validateTournamentInput>[0]) {
  const result = validateTournamentInput(input);
  if ("error" in result) throw new Error(`attendu valide, reçu ${result.error}`);
  return result.value;
}

describe("validateTournamentInput", () => {
  it("normalise les défauts d'un tournoi minimal", () => {
    const v = value(base);
    expect(v.name).toBe("Coupe test");
    expect(v.game).toBe("OW2");
    expect(v.participantType).toBe("TEAM");
    expect(v.description).toBeNull();
    expect(v.matchFormat).toBeNull();
    expect(v.phases).toBeNull();
  });

  it("coupe les espaces autour du nom", () => {
    expect(value({ ...base, name: "  Coupe  " }).name).toBe("Coupe");
  });

  it("refuse un nom vide", () => {
    expect(validateTournamentInput({ ...base, name: "   " })).toEqual({ error: "MISSING_NAME" });
  });

  it("refuse un format inconnu", () => {
    expect(validateTournamentInput({ ...base, format: "TRIPLE" as never })).toEqual({
      error: "INVALID_FORMAT",
    });
  });

  it("refuse un effectif hors bornes", () => {
    expect(validateTournamentInput({ ...base, maxTeams: 1 })).toEqual({
      error: "INVALID_MAX_TEAMS",
    });
    expect(validateTournamentInput({ ...base, maxTeams: 257 })).toEqual({
      error: "INVALID_MAX_TEAMS",
    });
  });

  it("refuse un demi-format de match", () => {
    expect(validateTournamentInput({ ...base, matchFormatType: "BO" })).toEqual({
      error: "INVALID_MATCH_FORMAT",
    });
  });

  it("accepte un BO5 complet", () => {
    expect(value({ ...base, matchFormatType: "BO", matchFormatValue: 5 }).matchFormat).toEqual({
      type: "BO",
      value: 5,
    });
  });

  it("refuse un barème suisse non monotone", () => {
    expect(
      validateTournamentInput({
        ...base,
        format: "SWISS",
        swissPointsWin: 1,
        swissPointsDraw: 3,
        swissPointsLoss: 0,
      }),
    ).toEqual({ error: "INVALID_SWISS_POINTS" });
  });

  it("refuse un barème suisse dont seul le point de victoire est fourni à zéro", () => {
    expect(
      validateTournamentInput({ ...base, format: "SWISS", swissPointsWin: 0 }),
    ).toEqual({ error: "INVALID_SWISS_POINTS" });
  });

  it("exige une cadence de coupe en survie", () => {
    expect(validateTournamentInput({ ...base, format: "SURVIVAL" })).toEqual({
      error: "INVALID_SURVIVAL_ROUNDS",
    });
  });

  it("retombe sur la cadence pour la première coupe", () => {
    const v = value({ ...base, format: "SURVIVAL", survivalRoundsPerCut: 2 });
    expect(v.survivalRoundsBeforeFirstCut).toBe(2);
  });

  it("ignore les réglages d'un format qui ne les porte pas", () => {
    const v = value({ ...base, format: "SINGLE", survivalRoundsPerCut: 3, swissTotalRounds: 5 });
    expect(v.survivalRoundsPerCut).toBeNull();
    expect(v.swissTotalRounds).toBeNull();
  });

  it("refuse un plan de phases vide en MULTI", () => {
    expect(validateTournamentInput({ ...base, format: "MULTI", phases: [] })).toEqual({
      error: "MISSING_PHASES",
    });
  });

  it("refuse une double élimination ailleurs qu'en phase finale", () => {
    const phases = [
      { format: "DOUBLE", qualifierMode: "COUNT", qualifierValue: 8 },
      { format: "SINGLE", qualifierMode: "COUNT", qualifierValue: 1 },
    ];
    expect(validateTournamentInput({ ...base, format: "MULTI", phases })).toEqual({
      error: "DOUBLE_MUST_BE_LAST_PHASE",
    });
  });
});

describe("validateDateOrder", () => {
  const d = (h: number) => new Date(Date.parse("2026-08-27T12:00:00.000Z") + h * 3600_000).toISOString();

  it("accepte un ordre croissant", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: d(0),
        registrationOpenAt: d(1),
        registrationCloseAt: d(2),
        startAt: d(3),
      }),
    ).toBeNull();
  });

  it("accepte des dates égales", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: d(0),
        registrationOpenAt: d(0),
        registrationCloseAt: d(0),
        startAt: d(0),
      }),
    ).toBeNull();
  });

  it("refuse un ordre inversé", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: d(3),
        registrationOpenAt: d(1),
        registrationCloseAt: d(2),
        startAt: d(4),
      }),
    ).toBe("INVALID_DATE_ORDER");
  });

  it("refuse une date illisible", () => {
    expect(
      validateDateOrder({
        startVisibilityAt: "n'importe quoi",
        registrationOpenAt: d(1),
        registrationCloseAt: d(2),
        startAt: d(3),
      }),
    ).toBe("INVALID_DATES");
  });
});
