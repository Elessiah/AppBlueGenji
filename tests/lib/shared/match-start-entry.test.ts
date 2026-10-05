import { describe, expect, it } from "@jest/globals";
import {
  MATCH_ENTRY_DEFAULT_TIME,
  MATCH_ENTRY_HALF_HOURS,
  MATCH_ENTRY_MONTHS,
  formatMatchStartEntryPreview,
  isMatchStartEntryInRange,
  localMatchTimeIfDifferent,
  matchEntryReference,
  matchEntryTimeOptions,
  matchEntryTimeValue,
  matchStartEntryOf,
  nextValidYearShift,
  parisInstant,
  parseMatchEntryTime,
  readMatchStartEntry,
  resolveMatchStartEntry,
  shiftMatchStartYear,
  withYearShift,
} from "@/lib/shared/match-start-entry";

// Instants absolus partout : le résultat ne doit pas dépendre du fuseau de la
// machine qui exécute les tests (la saisie est à l'heure de Paris).
const at = (iso: string) => Date.parse(iso);
const iso = (instant: number | null) => (instant === null ? null : new Date(instant).toISOString());

describe("parisInstant", () => {
  it("lit l'heure d'hiver (UTC+1) et l'heure d'été (UTC+2)", () => {
    expect(iso(parisInstant(2027, 1, 3, 20, 0))).toBe("2027-01-03T19:00:00.000Z");
    expect(iso(parisInstant(2026, 8, 29, 20, 30))).toBe("2026-08-29T18:30:00.000Z");
  });

  it("passage à l'heure d'été (29 mars 2026) : l'heure avalée est décalée d'une heure", () => {
    expect(iso(parisInstant(2026, 3, 29, 1, 30))).toBe("2026-03-29T00:30:00.000Z");
    // 2 h 30 n'existe pas : lue avec le décalage d'hiver, elle tombe à 3 h 30.
    expect(iso(parisInstant(2026, 3, 29, 2, 30))).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(parisInstant(2026, 3, 29, 3, 0))).toBe("2026-03-29T01:00:00.000Z");
    expect(iso(parisInstant(2026, 3, 29, 20, 0))).toBe("2026-03-29T18:00:00.000Z");
    expect(iso(parisInstant(2026, 3, 28, 20, 0))).toBe("2026-03-28T19:00:00.000Z");
  });

  it("passage à l'heure d'hiver (25 octobre 2026) : l'heure doublée retient la première", () => {
    expect(iso(parisInstant(2026, 10, 25, 2, 30))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(parisInstant(2026, 10, 25, 3, 0))).toBe("2026-10-25T02:00:00.000Z");
    expect(iso(parisInstant(2026, 10, 24, 20, 0))).toBe("2026-10-24T18:00:00.000Z");
    expect(iso(parisInstant(2026, 10, 25, 20, 0))).toBe("2026-10-25T19:00:00.000Z");
  });
});

describe("resolveMatchStartEntry", () => {
  const entry = (day: number, month: number, hour = 20, minute = 0) => ({ day, month, hour, minute });

  it("garde l'année de la référence pour une date proche", () => {
    expect(iso(resolveMatchStartEntry(entry(15, 10), at("2026-10-01T10:00:00Z")))).toBe(
      "2026-10-15T18:00:00.000Z",
    );
  });

  it("décembre → janvier : passe à l'année suivante", () => {
    expect(iso(resolveMatchStartEntry(entry(3, 1), at("2026-12-20T18:00:00Z")))).toBe(
      "2027-01-03T19:00:00.000Z",
    );
  });

  it("janvier → décembre : correction d'un match passé, l'année précédente", () => {
    expect(iso(resolveMatchStartEntry(entry(28, 12), at("2027-01-05T18:00:00Z")))).toBe(
      "2026-12-28T19:00:00.000Z",
    );
  });

  it("lit l'année de la référence à Paris, pas en UTC", () => {
    // 31 décembre 23 h 30 UTC = 1er janvier 0 h 30 à Paris : Y = 2027.
    const reference = at("2026-12-31T23:30:00Z");
    expect(iso(resolveMatchStartEntry(entry(2, 1), reference))).toBe("2027-01-02T19:00:00.000Z");
    expect(iso(resolveMatchStartEntry(entry(30, 12), reference))).toBe("2026-12-30T19:00:00.000Z");
  });

  it("à trois mois de distance, l'année reste la bonne dans les deux sens", () => {
    const reference = at("2026-11-15T12:00:00Z");
    expect(iso(resolveMatchStartEntry(entry(15, 2), reference))).toBe("2027-02-15T19:00:00.000Z");
    expect(iso(resolveMatchStartEntry(entry(15, 8), reference))).toBe("2026-08-15T18:00:00.000Z");
  });

  it("29 février : retient l'année bissextile voisine", () => {
    expect(iso(resolveMatchStartEntry(entry(29, 2), at("2027-12-15T12:00:00Z")))).toBe(
      "2028-02-29T19:00:00.000Z",
    );
    expect(iso(resolveMatchStartEntry(entry(29, 2), at("2024-01-10T12:00:00Z")))).toBe(
      "2024-02-29T19:00:00.000Z",
    );
  });

  it("29 février sans année bissextile parmi les candidates : refusé", () => {
    expect(resolveMatchStartEntry(entry(29, 2), at("2026-06-01T12:00:00Z"))).toBeNull();
  });

  it("un jour absent du mois (31 avril) est refusé", () => {
    expect(resolveMatchStartEntry(entry(31, 4), at("2026-10-01T12:00:00Z"))).toBeNull();
    expect(resolveMatchStartEntry(entry(30, 4), at("2026-10-01T12:00:00Z"))).not.toBeNull();
  });

  it("refuse une saisie hors bornes", () => {
    const reference = at("2026-10-01T12:00:00Z");
    expect(resolveMatchStartEntry(entry(0, 1), reference)).toBeNull();
    expect(resolveMatchStartEntry(entry(32, 1), reference)).toBeNull();
    expect(resolveMatchStartEntry(entry(1, 13), reference)).toBeNull();
    expect(resolveMatchStartEntry(entry(1, 1, 24), reference)).toBeNull();
    expect(resolveMatchStartEntry(entry(1, 1, 20, 60), reference)).toBeNull();
    expect(resolveMatchStartEntry(entry(1.5, 1), reference)).toBeNull();
    expect(resolveMatchStartEntry(entry(1, 1), Number.NaN)).toBeNull();
  });

  it("écarte une candidate hors des bornes absolues du serveur", () => {
    // Référence en 2100 : 2101 n'est jamais proposée, même plus proche.
    expect(iso(resolveMatchStartEntry(entry(5, 1), at("2100-12-30T12:00:00Z")))).toBe(
      "2100-01-05T19:00:00.000Z",
    );
  });
});

describe("matchEntryReference", () => {
  const now = at("2026-10-01T10:00:00Z");
  const ref = (tournamentStartAt: string | null, tournamentFinished = false) =>
    matchEntryReference({ tournamentStartAt, tournamentFinished }, now);

  it("tournoi à venir : son début", () => {
    expect(ref("2026-12-05T19:00:00.000Z")).toBe(at("2026-12-05T19:00:00Z"));
  });

  it("tournoi en cours depuis des mois : aujourd'hui", () => {
    expect(ref("2026-01-10T19:00:00.000Z")).toBe(now);
  });

  it("tournoi terminé : son début (correction d'archive)", () => {
    expect(ref("2025-12-28T19:00:00.000Z", true)).toBe(at("2025-12-28T19:00:00Z"));
  });

  it("se rabat sur maintenant sans début lisible", () => {
    expect(ref(null)).toBe(now);
    expect(ref("n'importe quoi", true)).toBe(now);
  });

  it("ligue commencée en janvier, match saisi en juillet : l'année en cours", () => {
    // Avec le seul début du tournoi comme référence, le 15 juillet tombait en
    // 2025 (179 jours) plutôt qu'en 2026 (186 jours).
    const july = { day: 15, month: 7, hour: 20, minute: 0 };
    const reference = matchEntryReference(
      { tournamentStartAt: "2026-01-10T19:00:00.000Z", tournamentFinished: false },
      at("2026-07-01T10:00:00Z"),
    );
    expect(iso(resolveMatchStartEntry(july, reference))).toBe("2026-07-15T18:00:00.000Z");
  });

  it("change l'année déduite : tournoi terminé contre tournoi en cours", () => {
    const fifthOfJanuary = { day: 5, month: 1, hour: 20, minute: 0 };
    expect(iso(resolveMatchStartEntry(fifthOfJanuary, ref("2025-12-28T19:00:00.000Z", true)))).toBe(
      "2026-01-05T19:00:00.000Z",
    );
    expect(iso(resolveMatchStartEntry(fifthOfJanuary, ref("2025-12-28T19:00:00.000Z")))).toBe(
      "2027-01-05T19:00:00.000Z",
    );
  });

  it("un match reporté de mars à janvier suivant passe bien à l'année suivante", () => {
    // Tournoi en cours, date posée en mars 2026 jamais jouée : reprogrammé le
    // 15 décembre 2026 au « 5 janvier », il tombe en 2027, pas en 2026.
    const reference = matchEntryReference(
      { tournamentStartAt: "2026-02-01T19:00:00.000Z", tournamentFinished: false },
      at("2026-12-15T10:00:00Z"),
    );
    expect(iso(resolveMatchStartEntry({ day: 5, month: 1, hour: 20, minute: 0 }, reference))).toBe(
      "2027-01-05T19:00:00.000Z",
    );
  });
});

describe("matchStartEntryOf", () => {
  it("pré-remplit jour, mois et heure de Paris", () => {
    expect(matchStartEntryOf("2027-01-03T19:00:00.000Z")).toEqual({ day: 3, month: 1, hour: 20, minute: 0 });
    expect(matchStartEntryOf("2026-12-31T23:30:00.000Z")).toEqual({ day: 1, month: 1, hour: 0, minute: 30 });
  });

  it("fait l'aller-retour avec la déduction", () => {
    const startAt = "2026-08-29T18:30:00.000Z";
    const entry = matchStartEntryOf(startAt);
    expect(entry).not.toBeNull();
    if (entry) expect(iso(resolveMatchStartEntry(entry, at("2026-08-01T00:00:00Z")))).toBe(startAt);
  });

  it("rend null sans date exploitable", () => {
    expect(matchStartEntryOf(null)).toBeNull();
    expect(matchStartEntryOf("n'importe quoi")).toBeNull();
  });
});

describe("formatMatchStartEntryPreview", () => {
  it("écrit la date complète, année comprise, à l'heure de Paris", () => {
    const text = formatMatchStartEntryPreview(at("2027-01-03T19:00:00Z")).replaceAll(/\s/g, " ");
    expect(text).toBe("dimanche 3 janvier 2027 à 20:00");
  });
});

describe("localMatchTimeIfDifferent", () => {
  const instant = at("2026-08-29T18:30:00Z");

  it("rien à ajouter à l'heure de Paris", () => {
    expect(localMatchTimeIfDifferent(instant, "Europe/Paris")).toBeNull();
    expect(localMatchTimeIfDifferent(instant, "Europe/Brussels")).toBeNull();
  });

  it("donne l'heure locale hors du fuseau de Paris", () => {
    expect(localMatchTimeIfDifferent(instant, "America/Martinique")?.replaceAll(/\s/g, " ")).toBe("29/08/2026 14:30");
    expect(localMatchTimeIfDifferent(instant, "UTC")?.replaceAll(/\s/g, " ")).toBe("29/08/2026 18:30");
  });

  it("ignore un fuseau inconnu", () => {
    expect(localMatchTimeIfDifferent(instant, "Pas/UnFuseau")).toBeNull();
  });
});

describe("heure du champ", () => {
  it("formate et relit HH:MM", () => {
    expect(matchEntryTimeValue({ hour: 9, minute: 5 })).toBe("09:05");
    expect(parseMatchEntryTime("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseMatchEntryTime("20:30:15")).toEqual({ hour: 20, minute: 30 });
  });

  it("refuse une heure illisible", () => {
    expect(parseMatchEntryTime("")).toBeNull();
    expect(parseMatchEntryTime("24:00")).toBeNull();
    expect(parseMatchEntryTime("20:60")).toBeNull();
    expect(parseMatchEntryTime("8:00")).toBeNull();
  });

  it("propose les 48 demi-heures, 21:00 par défaut", () => {
    expect(MATCH_ENTRY_HALF_HOURS).toHaveLength(48);
    expect(MATCH_ENTRY_HALF_HOURS[0]).toBe("00:00");
    expect(MATCH_ENTRY_HALF_HOURS[1]).toBe("00:30");
    expect(MATCH_ENTRY_HALF_HOURS.at(-1)).toBe("23:30");
    expect(MATCH_ENTRY_HALF_HOURS.every((value) => /^\d{2}:(00|30)$/.test(value))).toBe(true);
    expect(MATCH_ENTRY_HALF_HOURS).toContain(MATCH_ENTRY_DEFAULT_TIME);
    expect(MATCH_ENTRY_DEFAULT_TIME).toBe("21:00");
  });

  it("garde à sa place une heure posée entre deux demi-heures", () => {
    expect(matchEntryTimeOptions()).toBe(MATCH_ENTRY_HALF_HOURS);
    expect(matchEntryTimeOptions("20:30")).toBe(MATCH_ENTRY_HALF_HOURS);
    const options = matchEntryTimeOptions("20:45");
    expect(options).toHaveLength(49);
    expect(options.slice(41, 44)).toEqual(["20:30", "20:45", "21:00"]);
    expect(matchEntryTimeOptions("00:05").slice(0, 3)).toEqual(["00:00", "00:05", "00:30"]);
    expect(matchEntryTimeOptions("23:59").at(-1)).toBe("23:59");
  });

  it("ignore une heure posée illisible", () => {
    expect(matchEntryTimeOptions("")).toBe(MATCH_ENTRY_HALF_HOURS);
    expect(matchEntryTimeOptions("24:10")).toBe(MATCH_ENTRY_HALF_HOURS);
  });

  it("borne la saisie", () => {
    expect(isMatchStartEntryInRange({ day: 31, month: 12, hour: 23, minute: 59 })).toBe(true);
    expect(isMatchStartEntryInRange({ day: 1, month: 0, hour: 0, minute: 0 })).toBe(false);
    expect(MATCH_ENTRY_MONTHS).toHaveLength(12);
  });
});

describe("décalage d'année", () => {
  it("garde le jour et l'heure de Paris, été comme hiver", () => {
    expect(iso(shiftMatchStartYear(at("2026-08-20T18:00:00Z"), 1))).toBe("2027-08-20T18:00:00.000Z");
    expect(iso(shiftMatchStartYear(at("2027-01-03T19:00:00Z"), -1))).toBe("2026-01-03T19:00:00.000Z");
    expect(iso(shiftMatchStartYear(at("2027-01-03T19:00:00Z"), -2))).toBe("2025-01-03T19:00:00.000Z");
  });

  it("refuse un 29 février hors bissextile et les bornes du serveur", () => {
    expect(shiftMatchStartYear(at("2028-02-29T19:00:00Z"), 1)).toBeNull();
    expect(iso(shiftMatchStartYear(at("2028-02-29T19:00:00Z"), 4))).toBe("2032-02-29T19:00:00.000Z");
    expect(shiftMatchStartYear(at("2100-06-01T18:00:00Z"), 1)).toBeNull();
    expect(shiftMatchStartYear(at("2026-06-01T18:00:00Z"), 0.5)).toBeNull();
  });

  it("prochain décalage valable : un cran, ou quatre pour un 29 février", () => {
    const ordinary = at("2026-08-20T18:00:00Z");
    expect(nextValidYearShift(ordinary, 0, -1)).toBe(-1);
    expect(nextValidYearShift(ordinary, 0, 1)).toBe(1);
    expect(nextValidYearShift(ordinary, -1, -1)).toBe(-2);
    const leap = at("2028-02-29T19:00:00Z");
    expect(nextValidYearShift(leap, 0, -1)).toBe(-4);
    expect(nextValidYearShift(leap, 0, 1)).toBe(4);
    // 2096 → 2100 n'est pas bissextile et 2104 sort des bornes.
    expect(nextValidYearShift(at("2096-02-29T19:00:00Z"), 0, 1)).toBeNull();
  });

  it("corrige l'archive d'un match joué il y a plus de six mois", () => {
    // Ligue en cours, aujourd'hui octobre 2026 : « 15 février » se déduit en
    // 2027 ; un cran en arrière ramène le match joué en février 2026.
    const reference = matchEntryReference(
      { tournamentStartAt: "2025-09-01T18:00:00.000Z", tournamentFinished: false },
      at("2026-10-01T10:00:00Z"),
    );
    const deduced = readMatchStartEntry({ day: "15", month: "2", time: "20:00" }, reference);
    expect(deduced).toEqual({ kind: "ready", instant: at("2027-02-15T19:00:00Z") });
    expect(withYearShift(deduced, -1)).toEqual({ kind: "ready", instant: at("2026-02-15T19:00:00Z") });
  });

  it("corrige une année déjà fausse sur le match", () => {
    const current = "2026-01-12T19:00:00.000Z";
    const kept = readMatchStartEntry(
      { day: "12", month: "1", time: "21:00" },
      at("2026-12-20T10:00:00Z"),
      current,
    );
    expect(kept).toEqual({ kind: "ready", instant: at("2026-01-12T20:00:00Z") });
    expect(withYearShift(kept, 1)).toEqual({ kind: "ready", instant: at("2027-01-12T20:00:00Z") });
  });

  it("laisse passer les autres états, et signale une année impossible", () => {
    expect(withYearShift({ kind: "empty" }, 1)).toEqual({ kind: "empty" });
    expect(withYearShift({ kind: "incomplete", field: "time" }, -1)).toEqual({ kind: "incomplete", field: "time" });
    const ready = { kind: "ready" as const, instant: at("2028-02-29T19:00:00Z") };
    expect(withYearShift(ready, 0)).toBe(ready);
    expect(withYearShift(ready, 1)).toEqual({ kind: "invalid", field: "day" });
  });
});

describe("readMatchStartEntry", () => {
  const reference = at("2026-12-20T18:00:00Z");
  const raw = (day: string, month: string, time: string) => ({ day, month, time });

  it("ni jour ni mois : effacement, quelle que soit l'heure", () => {
    expect(readMatchStartEntry(raw("", "", ""), reference)).toEqual({ kind: "empty" });
    // L'heure par défaut de la liste ne programme rien à elle seule.
    expect(readMatchStartEntry(raw("", "", MATCH_ENTRY_DEFAULT_TIME), reference)).toEqual({ kind: "empty" });
    expect(readMatchStartEntry(raw("", "", "18:30"), reference)).toEqual({ kind: "empty" });
  });

  it("désigne le premier champ manquant", () => {
    expect(readMatchStartEntry(raw("", "1", "20:00"), reference)).toEqual({ kind: "incomplete", field: "day" });
    expect(readMatchStartEntry(raw("3", "", "21:00"), reference)).toEqual({ kind: "incomplete", field: "month" });
    expect(readMatchStartEntry(raw("3", "1", ""), reference)).toEqual({ kind: "incomplete", field: "time" });
    expect(readMatchStartEntry(raw("3", "1", "25:00"), reference)).toEqual({ kind: "incomplete", field: "time" });
  });

  it("une heure hors demi-heure reste acceptée (date déjà posée)", () => {
    expect(readMatchStartEntry(raw("3", "1", "20:45"), reference)).toEqual({
      kind: "ready",
      instant: at("2027-01-03T19:45:00Z"),
    });
  });

  it("un jour absent du mois est désigné sur le jour", () => {
    expect(readMatchStartEntry(raw("31", "4", "20:00"), reference)).toEqual({ kind: "invalid", field: "day" });
  });

  it("jour et mois inchangés : l'année de la date posée est gardée", () => {
    // Ligue terminée commencée le 10 janvier 2026, match au 20 août 2026 : la
    // déduction seule le ramènerait en 2025 (plus proche du début).
    const tournamentStart = at("2026-01-10T19:00:00Z");
    const current = "2026-08-20T18:00:00.000Z";
    expect(readMatchStartEntry(raw("20", "8", "20:00"), tournamentStart)).toEqual({
      kind: "ready",
      instant: at("2025-08-20T18:00:00Z"),
    });
    expect(readMatchStartEntry(raw("20", "8", "20:00"), tournamentStart, current)).toEqual({
      kind: "ready",
      instant: at(current),
    });
    // Seule l'heure change : même jour, même année.
    expect(readMatchStartEntry(raw("20", "8", "21:15"), tournamentStart, current)).toEqual({
      kind: "ready",
      instant: at("2026-08-20T19:15:00Z"),
    });
  });

  it("date inchangée : l'instant exact, même sur l'heure doublée d'octobre", () => {
    // Seconde occurrence de 2 h 30 le 25 octobre 2026 (heure d'hiver).
    const current = "2026-10-25T01:30:00.000Z";
    expect(readMatchStartEntry(raw("25", "10", "02:30"), at("2026-10-01T00:00:00Z"), current)).toEqual({
      kind: "ready",
      instant: at(current),
    });
  });

  it("jour ou mois changé : la déduction reprend", () => {
    const current = "2026-03-10T19:00:00.000Z";
    expect(readMatchStartEntry(raw("5", "1", "20:00"), at("2026-12-15T10:00:00Z"), current)).toEqual({
      kind: "ready",
      instant: at("2027-01-05T19:00:00Z"),
    });
  });

  it("l'année gardée est celle de Paris", () => {
    // 31 décembre 2026 23 h 30 UTC = 1er janvier 2027 0 h 30 à Paris.
    expect(
      readMatchStartEntry(raw("1", "1", "00:30"), at("2026-06-01T00:00:00Z"), "2026-12-31T23:30:00.000Z"),
    ).toEqual({ kind: "ready", instant: at("2026-12-31T23:30:00Z") });
  });

  it("rend l'instant déduit", () => {
    expect(readMatchStartEntry(raw("3", "1", "20:00"), reference)).toEqual({
      kind: "ready",
      instant: at("2027-01-03T19:00:00Z"),
    });
  });
});
