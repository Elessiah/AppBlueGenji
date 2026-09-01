import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultTournamentFormValues,
  toApiPayload,
  toFormValues,
} from "@/app/(secured)/tournois/_components/TournamentForm";

describe("defaultTournamentFormValues", () => {
  it("propose un tournoi à élimination simple par équipes", () => {
    const v = defaultTournamentFormValues();
    expect(v.format).toBe("SINGLE");
    expect(v.participantType).toBe("TEAM");
    expect(v.game).toBe("OW2");
    expect(v.maxTeams).toBe(16);
  });

  it("propose quatre jalons dans l'ordre chronologique", () => {
    const v = defaultTournamentFormValues();
    const t = (s: string) => new Date(s).getTime();
    expect(t(v.startVisibilityAt)).toBeLessThanOrEqual(t(v.registrationOpenAt));
    expect(t(v.registrationOpenAt)).toBeLessThanOrEqual(t(v.registrationCloseAt));
    expect(t(v.registrationCloseAt)).toBeLessThanOrEqual(t(v.startAt));
  });
});

describe("toApiPayload", () => {
  const values = { ...defaultTournamentFormValues(), name: "Coupe test" };

  it("convertit les dates locales en ISO", () => {
    const payload = toApiPayload(values);
    expect(String(payload.startAt)).toMatch(/\dT.*Z$/);
  });

  it("aplatit le format de match en deux champs", () => {
    const payload = toApiPayload({ ...values, matchFormat: { type: "BO", value: 5 } });
    expect(payload.matchFormatType).toBe("BO");
    expect(payload.matchFormatValue).toBe(5);
  });

  it("rend deux champs nuls quand la saisie de score est libre", () => {
    const payload = toApiPayload({ ...values, matchFormat: null });
    expect(payload.matchFormatType).toBeNull();
    expect(payload.matchFormatValue).toBeNull();
  });

  it("n'envoie les phases qu'en format MULTI", () => {
    expect(toApiPayload({ ...values, format: "SINGLE" }).phases).toBeUndefined();
    expect(toApiPayload({ ...values, format: "MULTI" }).phases).toBeDefined();
  });

  it("n'envoie les réglages de survie qu'en format SURVIVAL", () => {
    expect(toApiPayload({ ...values, format: "SINGLE" }).survivalRoundsPerCut).toBeUndefined();
    expect(toApiPayload({ ...values, format: "SURVIVAL" }).survivalRoundsPerCut).toBeDefined();
  });

  it("n'envoie la petite finale qu'en élimination simple", () => {
    expect(toApiPayload({ ...values, format: "SINGLE", hasThirdPlaceMatch: true })
      .hasThirdPlaceMatch).toBe(true);
    expect(toApiPayload({ ...values, format: "DOUBLE", hasThirdPlaceMatch: true })
      .hasThirdPlaceMatch).toBe(false);
  });

  it("n'envoie le barème suisse qu'en ronde suisse", () => {
    expect(toApiPayload({ ...values, format: "SINGLE" }).swissPointsWin).toBeUndefined();
    expect(toApiPayload({ ...values, format: "SWISS" }).swissPointsWin).toBeDefined();
  });

  it("n'envoie les réglages d'endurance qu'en BlueGenji Survie", () => {
    expect(toApiPayload({ ...values, format: "SINGLE" }).endurancePoints).toBeUndefined();
    expect(toApiPayload({ ...values, format: "BG_SURVIE" }).endurancePoints).toBeDefined();
  });
});

describe("toFormValues", () => {
  // `GET /api/tournaments/[id]/edit` rend des dates ISO ; les champs
  // `datetime-local` n'acceptent que du temps local sans fuseau.
  const apiValues = {
    ...defaultTournamentFormValues(),
    description: null,
    startVisibilityAt: new Date("2030-01-02T10:30:00Z").toISOString(),
    registrationOpenAt: new Date("2030-01-03T10:30:00Z").toISOString(),
    registrationCloseAt: new Date("2030-01-04T10:30:00Z").toISOString(),
    startAt: new Date("2030-01-05T10:30:00Z").toISOString(),
    survivalRoundsPerCut: null,
    swissTotalRounds: null,
    endurancePoints: null,
    phases: null,
  };

  it("convertit les dates ISO en saisie locale", () => {
    const v = toFormValues(apiValues);
    expect(v.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(v.startAt).getTime()).toBe(new Date(apiValues.startAt).getTime());
  });

  it("retombe sur les défauts de création quand une valeur de format est absente", () => {
    const v = toFormValues(apiValues);
    const defaults = defaultTournamentFormValues();
    expect(v.survivalRoundsPerCut).toBe(defaults.survivalRoundsPerCut);
    expect(v.endurancePoints).toBe(defaults.endurancePoints);
    expect(v.phases).toEqual(defaults.phases);
  });

  it("rend une description absente comme une saisie vide", () => {
    expect(toFormValues(apiValues).description).toBe("");
  });

  it("fait l'aller-retour sans perte sur les dates", () => {
    const values = defaultTournamentFormValues();
    const back = toFormValues({
      ...values,
      startVisibilityAt: new Date(values.startVisibilityAt).toISOString(),
      registrationOpenAt: new Date(values.registrationOpenAt).toISOString(),
      registrationCloseAt: new Date(values.registrationCloseAt).toISOString(),
      startAt: new Date(values.startAt).toISOString(),
    });
    expect(back.startAt).toBe(values.startAt);
    expect(back.registrationOpenAt).toBe(values.registrationOpenAt);
  });
});

/**
 * Les deux notations sont offertes à la configuration, création comme édition.
 *
 * Le formulaire est partagé par `/tournois/creer` et `/tournois/[id]/modifier` :
 * une notation offerte à l'un l'est forcément à l'autre. Ces tests l'ancrent,
 * pour qu'un tournoi en `FT` reste configurable — et donc affichable — dans les
 * deux écrans.
 */
describe("format de match — les deux notations", () => {
  const values = { ...defaultTournamentFormValues(), name: "Coupe test" };

  it("aplatit un First to comme un Best of", () => {
    const payload = toApiPayload({ ...values, matchFormat: { type: "FT", value: 3 } });
    expect(payload.matchFormatType).toBe("FT");
    expect(payload.matchFormatValue).toBe(3);
  });

  it("fait l'aller-retour sans perte sur les deux notations", () => {
    for (const matchFormat of [
      { type: "BO", value: 5 },
      { type: "FT", value: 3 },
      null,
    ] as const) {
      const back = toFormValues({
        ...values,
        matchFormat,
        description: null,
        survivalRoundsPerCut: null,
        swissTotalRounds: null,
        endurancePoints: null,
        phases: null,
      });
      expect(back.matchFormat).toEqual(matchFormat);
    }
  });

  it("propose « Best of », « First to » et le score libre dans le même sélecteur", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "app", "(secured)", "tournois", "_components", "TournamentForm.tsx"),
      "utf8",
    );
    expect(source).toContain('<option value="BO">');
    expect(source).toContain('<option value="FT">');
    expect(source).toContain('<option value="LIBRE">');
  });

  it("le formulaire de modification est celui de la création", () => {
    const edit = readFileSync(
      join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "modifier", "page.tsx"),
      "utf8",
    );
    expect(edit).toContain("TournamentForm");
    expect(edit).toContain("_components/TournamentForm");
  });
});
