import { describe, expect, it } from "@jest/globals";
import {
  canViewTournament,
  isTournamentPublished,
} from "@/lib/shared/tournament-visibility";

const NOW = new Date("2026-08-31T12:00:00.000Z");

const HIDDEN = { startVisibilityAt: "2026-09-01T00:00:00.000Z" };
const PUBLISHED = { startVisibilityAt: "2026-08-30T00:00:00.000Z" };

describe("isTournamentPublished", () => {
  it("publie un tournoi dont la date de visibilité est passée", () => {
    expect(isTournamentPublished(PUBLISHED, NOW)).toBe(true);
  });

  it("garde caché un tournoi dont la date de visibilité est à venir", () => {
    expect(isTournamentPublished(HIDDEN, NOW)).toBe(false);
  });

  it("publie à la seconde exacte", () => {
    // La liste filtre en SQL avec `start_visibility_at <= NOW()` : la borne doit
    // être la même des deux côtés, sinon une fiche reste 404 alors que sa carte
    // est déjà listée.
    expect(isTournamentPublished({ startVisibilityAt: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("accepte une Date aussi bien qu'une chaîne ISO", () => {
    expect(isTournamentPublished({ startVisibilityAt: new Date(PUBLISHED.startVisibilityAt) }, NOW))
      .toBe(true);
    expect(isTournamentPublished({ startVisibilityAt: new Date(HIDDEN.startVisibilityAt) }, NOW))
      .toBe(false);
  });

  it("se ferme sur une date illisible", () => {
    // Garde d'accès : elle refuse quand elle ne sait pas. Le staff, lui, voit
    // toujours le tournoi et peut corriger la donnée.
    expect(isTournamentPublished({ startVisibilityAt: "pas une date" }, NOW)).toBe(false);
    expect(isTournamentPublished({ startVisibilityAt: "" }, NOW)).toBe(false);
  });
});

describe("canViewTournament", () => {
  it("laisse tout le monde lire un tournoi publié", () => {
    expect(canViewTournament(PUBLISHED, { canManage: false }, NOW)).toBe(true);
    expect(canViewTournament(PUBLISHED, { canManage: true }, NOW)).toBe(true);
  });

  it("refuse un tournoi non publié à qui n'a pas la permission `tournaments`", () => {
    expect(canViewTournament(HIDDEN, { canManage: false }, NOW)).toBe(false);
  });

  it("laisse le staff lire un tournoi non publié", () => {
    // Même audience que la section « Tournois invisibles » : une seule règle,
    // pas de divergence possible entre la liste et la fiche.
    expect(canViewTournament(HIDDEN, { canManage: true }, NOW)).toBe(true);
  });

  it("laisse le staff lire malgré une date illisible", () => {
    expect(canViewTournament({ startVisibilityAt: "???" }, { canManage: true }, NOW)).toBe(true);
    expect(canViewTournament({ startVisibilityAt: "???" }, { canManage: false }, NOW)).toBe(false);
  });
});
