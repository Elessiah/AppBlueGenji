import { describe, expect, it } from "@jest/globals";

import {
  invalidMatchFormatMessage,
  matchFormatHint,
  misplacedDateField,
} from "@/app/(secured)/tournois/_lib/tournament-form-values";
import { matchFormatDescription, matchFormatLabel, type MatchFormat } from "@/lib/shared/match-format";

describe("matchFormatHint", () => {
  const ft3: MatchFormat = { type: "FT", value: 3, maxMaps: null, drawsAllowed: false };

  it("saisie libre", () => {
    expect(matchFormatHint("LIBRE", true, null)).toBe("Les scores sont saisis sans contrainte.");
  });

  it("format valide : libellé et description", () => {
    expect(matchFormatHint("FT", true, ft3)).toBe(`${matchFormatLabel(ft3)} — ${matchFormatDescription(ft3)}`);
  });

  it("format invalide : ce qui manque, selon le type", () => {
    expect(matchFormatHint("BO", false, null)).toMatch(/nombre impair/);
    expect(matchFormatHint("FT", false, null)).toBe("Saisis le nombre de manches à gagner.");
  });
});

describe("invalidMatchFormatMessage", () => {
  it("distingue le Best of", () => {
    expect(invalidMatchFormatMessage("BO")).toMatch(/Best of/);
    expect(invalidMatchFormatMessage("FT")).toBe("Nombre de manches du format de match invalide.");
  });
});

describe("misplacedDateField", () => {
  const ordered = {
    startVisibilityAt: "2026-01-01T10:00",
    registrationOpenAt: "2026-01-02T10:00",
    registrationCloseAt: "2026-01-03T10:00",
    startAt: "2026-01-04T10:00",
  };

  it("ignore un refus qui n'est pas un refus d'ordre des dates", () => {
    expect(misplacedDateField(null, ordered)).toBeNull();
    expect(misplacedDateField("INVALID_NAME", { ...ordered, startAt: "2025-01-01T10:00" })).toBeNull();
  });

  it("désigne le premier jalon mal placé", () => {
    expect(misplacedDateField("INVALID_DATE_ORDER", { ...ordered, registrationCloseAt: "2026-01-01T09:00" })).toBe(
      "registrationCloseAt",
    );
  });
});
