import { describe, expect, it } from "@jest/globals";
import {
  parseTournamentDates,
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

  it("laisse la phase d'endurance sans plafond par défaut", () => {
    expect(value({ ...base, format: "BG_SURVIE" }).enduranceMaxRounds).toBeNull();
  });

  it("accepte un plafond de manches d'endurance", () => {
    expect(value({ ...base, format: "BG_SURVIE", enduranceMaxRounds: 6 }).enduranceMaxRounds).toBe(6);
  });

  it("refuse un plafond de manches hors bornes", () => {
    for (const enduranceMaxRounds of [0, -1, 51, 2.5]) {
      expect(
        validateTournamentInput({ ...base, format: "BG_SURVIE", enduranceMaxRounds }),
      ).toEqual({ error: "INVALID_ENDURANCE_SETTINGS" });
    }
  });

  // Le réglage n'appartient qu'au mode : l'envoyer sur un autre format ne doit
  // pas s'écrire en base, sans quoi une bascule de format ressusciterait un
  // plafond que personne n'a redemandé.
  it("ignore un plafond de manches hors du mode BlueGenji Survie", () => {
    expect(value({ ...base, format: "SINGLE", enduranceMaxRounds: 6 }).enduranceMaxRounds).toBeNull();
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

describe("parseTournamentDates — analyse unique", () => {
  const d = (hours: number) => new Date(Date.UTC(2026, 0, 1, hours)).toISOString();

  it("rend les quatre dates analysées quand l'ordre tient", () => {
    // `createTournament` insérait ces quatre `Date` après les avoir
    // reconstruites de son côté : deux analyses des mêmes chaînes.
    const parsed = parseTournamentDates({
      startVisibilityAt: d(1),
      registrationOpenAt: d(2),
      registrationCloseAt: d(3),
      startAt: d(4),
    });

    expect(parsed.error).toBeUndefined();
    expect(parsed.value?.startVisibilityAt.toISOString()).toBe(d(1));
    expect(parsed.value?.registrationOpenAt.toISOString()).toBe(d(2));
    expect(parsed.value?.registrationCloseAt.toISOString()).toBe(d(3));
    expect(parsed.value?.startAt.toISOString()).toBe(d(4));
  });

  it("ne rend aucune date quand l'ordre est inversé", () => {
    const parsed = parseTournamentDates({
      startVisibilityAt: d(4),
      registrationOpenAt: d(2),
      registrationCloseAt: d(3),
      startAt: d(5),
    });

    expect(parsed.error).toBe("INVALID_DATE_ORDER");
    expect(parsed.value).toBeUndefined();
  });

  it("ne rend aucune date quand l'une est illisible", () => {
    const parsed = parseTournamentDates({
      startVisibilityAt: "n'importe quoi",
      registrationOpenAt: d(2),
      registrationCloseAt: d(3),
      startAt: d(4),
    });

    expect(parsed.error).toBe("INVALID_DATES");
    expect(parsed.value).toBeUndefined();
  });

  it("dit exactement la même chose que validateDateOrder", () => {
    // L'une délègue à l'autre : leur verdict ne peut pas diverger.
    const cases = [
      { startVisibilityAt: d(1), registrationOpenAt: d(2), registrationCloseAt: d(3), startAt: d(4) },
      { startVisibilityAt: d(4), registrationOpenAt: d(2), registrationCloseAt: d(3), startAt: d(5) },
      { startVisibilityAt: "zzz", registrationOpenAt: d(2), registrationCloseAt: d(3), startAt: d(4) },
    ];

    for (const dates of cases) {
      expect(validateDateOrder(dates)).toBe(parseTournamentDates(dates).error ?? null);
    }
  });
});

describe("validateTournamentInput — petite finale", () => {
  it("garde la petite finale en élimination simple", () => {
    expect(value({ ...base, format: "SINGLE", hasThirdPlaceMatch: true }).hasThirdPlaceMatch).toBe(
      true,
    );
  });

  it.each([["DOUBLE"], ["SWISS"]] as const)(
    "la neutralise en %s",
    (format) => {
      // Cette règle ne vivait que dans `createTournament` : une **édition**
      // basculant un tournoi de SINGLE à DOUBLE laissait la case cochée en base,
      // et `rankEliminationPhase` la relit aussi en double élimination.
      const input = { ...base, format, hasThirdPlaceMatch: true } as Parameters<
        typeof validateTournamentInput
      >[0];
      expect(value(input).hasThirdPlaceMatch).toBe(false);
    },
  );
});
