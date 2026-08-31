import { describe, expect, it } from "@jest/globals";
import {
  formatMatchStartAt,
  formatMatchStartAtFull,
  isValidMatchStartAt,
  matchStartAtInputValue,
  matchStartAtTime,
  MATCH_START_AT_MAX_YEAR,
  MATCH_START_AT_MIN_YEAR,
  normalizeMatchStartAt,
} from "@/lib/shared/match-schedule";

describe("normalizeMatchStartAt", () => {
  it("normalise un ISO en UTC", () => {
    expect(normalizeMatchStartAt("2026-08-29T18:30:00Z")).toBe("2026-08-29T18:30:00.000Z");
  });

  it("accepte une Date", () => {
    expect(normalizeMatchStartAt(new Date("2026-08-29T18:30:00Z"))).toBe(
      "2026-08-29T18:30:00.000Z",
    );
  });

  it("accepte un horodatage en millisecondes", () => {
    const time = Date.UTC(2026, 7, 29, 18, 30);
    expect(normalizeMatchStartAt(time)).toBe(new Date(time).toISOString());
  });

  it("accepte la valeur d'un champ datetime-local, lue en heure locale", () => {
    // Le champ HTML n'a pas de fuseau : la valeur saisie est celle du
    // navigateur, et c'est bien ce que l'utilisateur a voulu dire.
    const normalized = normalizeMatchStartAt("2026-08-29T20:30");
    expect(normalized).toBe(new Date(2026, 7, 29, 20, 30).toISOString());
  });

  it("traite l'absence de date comme un effacement, pas comme une erreur", () => {
    expect(normalizeMatchStartAt(null)).toBeNull();
    expect(normalizeMatchStartAt(undefined)).toBeNull();
    expect(normalizeMatchStartAt("")).toBeNull();
    expect(normalizeMatchStartAt("   ")).toBeNull();
  });

  it("refuse une date illisible", () => {
    expect(normalizeMatchStartAt("demain soir")).toBeNull();
    expect(normalizeMatchStartAt("2026-13-45T99:99")).toBeNull();
    expect(normalizeMatchStartAt(new Date("nope"))).toBeNull();
    expect(normalizeMatchStartAt(Number.NaN)).toBeNull();
    expect(normalizeMatchStartAt(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("refuse un type qui n'est pas une date", () => {
    expect(normalizeMatchStartAt({})).toBeNull();
    expect(normalizeMatchStartAt([])).toBeNull();
    expect(normalizeMatchStartAt(true)).toBeNull();
  });

  it("écarte l'absurde par des bornes absolues", () => {
    // Un horodatage passé en secondes plutôt qu'en millisecondes.
    expect(normalizeMatchStartAt(1_772_000_000)).toBeNull();
    expect(normalizeMatchStartAt(`${MATCH_START_AT_MIN_YEAR - 1}-01-01T00:00:00Z`)).toBeNull();
    expect(normalizeMatchStartAt(`${MATCH_START_AT_MAX_YEAR + 1}-01-01T00:00:00Z`)).toBeNull();
  });

  it("accepte les bornes elles-mêmes", () => {
    expect(normalizeMatchStartAt(`${MATCH_START_AT_MIN_YEAR}-01-01T00:00:00Z`)).not.toBeNull();
    expect(normalizeMatchStartAt(`${MATCH_START_AT_MAX_YEAR}-12-31T23:00:00Z`)).not.toBeNull();
  });

  it("laisse programmer un match longtemps à l'avance comme corriger un match passé", () => {
    expect(normalizeMatchStartAt("2036-01-01T12:00:00Z")).not.toBeNull();
    expect(normalizeMatchStartAt("2020-01-01T12:00:00Z")).not.toBeNull();
  });
});

describe("isValidMatchStartAt", () => {
  it("suit exactement la normalisation", () => {
    expect(isValidMatchStartAt("2026-08-29T18:30:00Z")).toBe(true);
    expect(isValidMatchStartAt("")).toBe(false);
    expect(isValidMatchStartAt("1970-01-01T00:00:00Z")).toBe(false);
  });
});

describe("matchStartAtTime", () => {
  it("rend l'instant d'une date exploitable", () => {
    const time = Date.UTC(2026, 7, 29, 18, 30);
    expect(matchStartAtTime({ startAt: "2026-08-29T18:30:00Z" })).toBe(time);
    expect(matchStartAtTime({ startAt: new Date(time) })).toBe(time);
  });

  it("rend null pour une date absente ou illisible", () => {
    expect(matchStartAtTime({ startAt: null })).toBeNull();
    expect(matchStartAtTime({ startAt: undefined })).toBeNull();
    expect(matchStartAtTime({ startAt: "pas une date" })).toBeNull();
  });
});

describe("matchStartAtInputValue", () => {
  it("rend une valeur relisible par le champ HTML, en heure locale", () => {
    const local = new Date(2026, 7, 29, 20, 30);
    const value = matchStartAtInputValue(local.toISOString());
    expect(value).toBe("2026-08-29T20:30");
  });

  it("fait l'aller-retour avec la normalisation", () => {
    const local = new Date(2026, 2, 15, 9, 5);
    const value = matchStartAtInputValue(local.toISOString());
    expect(normalizeMatchStartAt(value)).toBe(local.toISOString());
  });

  it("vide le champ plutôt que d'y afficher une date invalide", () => {
    expect(matchStartAtInputValue(null)).toBe("");
    expect(matchStartAtInputValue("n'importe quoi")).toBe("");
  });
});

describe("formatMatchStartAt", () => {
  it("rend un libellé court", () => {
    const label = formatMatchStartAt(new Date(2026, 7, 29, 20, 30).toISOString());
    expect(label).toBe("29/08 20:30");
  });

  it("rend null sans date", () => {
    expect(formatMatchStartAt(null)).toBeNull();
    expect(formatMatchStartAt("bof")).toBeNull();
  });
});

describe("formatMatchStartAtFull", () => {
  it("rend un libellé complet, distinct du court", () => {
    const iso = new Date(2026, 7, 29, 20, 30).toISOString();
    const full = formatMatchStartAtFull(iso);
    expect(full).toBeTruthy();
    expect(full).not.toBe(formatMatchStartAt(iso));
    expect(full).toContain("2026");
  });

  it("rend null sans date", () => {
    expect(formatMatchStartAtFull(null)).toBeNull();
  });
});
