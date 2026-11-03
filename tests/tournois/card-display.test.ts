import { describe, expect, it, jest } from "@jest/globals";
import {
  CARD_DATE_FORMAT_TTL_MS,
  formatCardDate,
  progressPercent,
  registrationFill,
  runningCardAction,
  upcomingCardFace,
} from "@/app/(secured)/tournois/_lib/card-display";
import type { TournamentFormat } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

describe("runningCardAction", () => {
  it.each<[TournamentFormat, string]>([
    ["SINGLE", "Voir le bracket"],
    ["DOUBLE", "Voir le bracket"],
    ["SWISS", "Voir le classement"],
    ["SURVIVAL", "Voir le classement"],
    ["BG_SURVIE", "Voir le classement"],
    ["MULTI", "Voir le tournoi"],
  ])("%s → %s", (format, label) => {
    expect(runningCardAction(format)).toBe(label);
  });

  it("ne promet un arbre qu'aux formats qui en ont un", () => {
    for (const format of ["SWISS", "SURVIVAL", "BG_SURVIE", "MULTI"] as const) {
      expect(runningCardAction(format)).not.toMatch(/bracket/i);
    }
  });
});

describe("upcomingCardFace", () => {
  const card = tournamentCard({
    state: "UPCOMING",
    startVisibilityAt: "2026-05-01T10:00:00.000Z",
    registrationOpenAt: "2026-05-02T10:00:00.000Z",
    registrationCloseAt: "2026-05-10T10:00:00.000Z",
    startAt: "2026-05-12T10:00:00.000Z",
  });
  const at = (iso: string) => new Date(iso).getTime();

  it("annonce un tournoi dont les inscriptions ne sont pas ouvertes", () => {
    expect(upcomingCardFace(card, at("2026-05-01T12:00:00.000Z"))).toBe("ANNOUNCED");
  });

  it("reconnaît des inscriptions closes en attente du coup d'envoi", () => {
    expect(upcomingCardFace(card, at("2026-05-11T12:00:00.000Z"))).toBe("LOCKED");
  });

  it("garde l'instant de clôture dans les inscriptions (borne comprise)", () => {
    expect(upcomingCardFace(card, at("2026-05-10T10:00:00.000Z"))).toBe("ANNOUNCED");
  });

  it("traite un tournoi encore masqué comme annoncé", () => {
    expect(upcomingCardFace(card, at("2026-04-01T00:00:00.000Z"))).toBe("ANNOUNCED");
  });
});

describe("registrationFill", () => {
  it("rend la part des places prises", () => {
    expect(registrationFill({ registeredTeams: 3, maxTeams: 8 })).toEqual({
      ratio: 3 / 8,
      percent: 37,
      full: false,
    });
  });

  it("n'annonce jamais 100 % sur un plateau qui a encore une place", () => {
    expect(registrationFill({ registeredTeams: 199, maxTeams: 200 })).toMatchObject({
      percent: 99,
      full: false,
    });
  });

  it("dit complet un plateau plein", () => {
    expect(registrationFill({ registeredTeams: 8, maxTeams: 8 })).toMatchObject({
      percent: 100,
      full: true,
    });
  });

  it("borne un dépassement au plein", () => {
    expect(registrationFill({ registeredTeams: 10, maxTeams: 8 })).toMatchObject({
      ratio: 1,
      percent: 100,
      full: true,
    });
  });

  it("ne remplit rien sur une capacité nulle, au lieu d'un NaN", () => {
    expect(registrationFill({ registeredTeams: 2, maxTeams: 0 })).toEqual({
      ratio: 0,
      percent: 0,
      full: false,
    });
  });
});

describe("progressPercent", () => {
  it("tait un avancement inconnu", () => {
    expect(progressPercent(null)).toBeNull();
    expect(progressPercent(Number.NaN)).toBeNull();
  });

  it("tronque plutôt qu'arrondir : 99,6 % n'est pas terminé", () => {
    expect(progressPercent(0.996)).toBe(99);
    expect(progressPercent(0.5714)).toBe(57);
  });

  it("borne l'avancement entre 0 et 100", () => {
    expect(progressPercent(1)).toBe(100);
    expect(progressPercent(1.4)).toBe(100);
    expect(progressPercent(-0.2)).toBe(0);
  });
});

describe("formatCardDate", () => {
  it("rend un tiret pour une date absente ou illisible", () => {
    expect(formatCardDate(null, true)).toBe("—");
    expect(formatCardDate("pas une date", false)).toBe("—");
  });

  it("n'écrit ni heure ni secondes sans heure demandée", () => {
    const label = formatCardDate("2026-05-12T10:00:00.000Z", false);
    expect(label).toMatch(/2026/);
    expect(label).not.toMatch(/:/);
  });

  it("écrit heure et minutes, jamais les secondes", () => {
    const label = formatCardDate("2026-05-12T10:00:00.000Z", true);
    expect(label).toMatch(/\d{2}:\d{2}/);
    expect(label).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("formatCardDate — formateurs mis en cache", () => {
  const ISO = "2026-05-12T10:00:00.000Z";

  it("ne construit qu'un Intl.DateTimeFormat par langue et par variante, quel que soit le nombre d'appels", () => {
    const construct = jest.spyOn(Intl, "DateTimeFormat");
    // Premier appel de chaque couple (langue, avec/sans heure) : un formateur chacun…
    formatCardDate(ISO, true, "fr");
    formatCardDate(ISO, false, "fr");
    formatCardDate(ISO, true, "en");
    formatCardDate(ISO, false, "en");
    const afterFirst = construct.mock.calls.length;
    // …puis aucun de plus, même pour des centaines de cartes.
    for (let card = 0; card < 200; card += 1) {
      formatCardDate(ISO, true, "fr");
      formatCardDate(ISO, false, "en");
    }
    const constructed = construct.mock.calls.length;
    construct.mockRestore();

    expect(afterFirst).toBeLessThanOrEqual(4);
    expect(constructed).toBe(afterFirst);
  });

  it("garde les formes propres à chaque langue : jour sur deux chiffres en français seulement", () => {
    expect(formatCardDate("2026-10-07T10:00:00.000Z", false, "fr")).toMatch(/^07 /);
    expect(formatCardDate("2026-10-07T10:00:00.000Z", false, "en")).toMatch(/^Oct 7, 2026$/);
  });

  it("n'écrit pas la même chose avec et sans l'heure, une variante ne contaminant pas l'autre", () => {
    const withTime = formatCardDate(ISO, true, "en");
    const withoutTime = formatCardDate(ISO, false, "en");
    expect(withTime).toMatch(/\d{2}:\d{2}/);
    expect(withoutTime).not.toMatch(/:/);
    expect(formatCardDate(ISO, true, "en")).toBe(withTime);
  });
});

describe("formatCardDate — fuseau relu après le délai", () => {
  const ISO = "2026-05-12T10:00:00.000Z";

  it("reconstruit les formateurs passé CARD_DATE_FORMAT_TTL_MS, pas avant", () => {
    const base = Date.now() + 10 * CARD_DATE_FORMAT_TTL_MS;
    const clock = jest.spyOn(Date, "now").mockReturnValue(base);
    formatCardDate(ISO, true, "fr");
    const construct = jest.spyOn(Intl, "DateTimeFormat");

    clock.mockReturnValue(base + CARD_DATE_FORMAT_TTL_MS - 1);
    formatCardDate(ISO, true, "fr");
    expect(construct).not.toHaveBeenCalled();

    clock.mockReturnValue(base + CARD_DATE_FORMAT_TTL_MS);
    const before = formatCardDate(ISO, true, "fr");
    expect(construct).toHaveBeenCalledTimes(1);
    expect(formatCardDate(ISO, true, "fr")).toBe(before);
    expect(construct).toHaveBeenCalledTimes(1);

    construct.mockRestore();
    clock.mockRestore();
  });

  it("reconstruit aussi quand l'horloge recule (réglage de l'appareil)", () => {
    const base = Date.now() + 100 * CARD_DATE_FORMAT_TTL_MS;
    const clock = jest.spyOn(Date, "now").mockReturnValue(base);
    formatCardDate(ISO, false, "en");
    const construct = jest.spyOn(Intl, "DateTimeFormat");
    clock.mockReturnValue(base - 5_000);
    formatCardDate(ISO, false, "en");
    expect(construct).toHaveBeenCalledTimes(1);
    construct.mockRestore();
    clock.mockRestore();
  });
});
