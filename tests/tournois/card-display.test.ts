import { describe, expect, it } from "@jest/globals";
import {
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
