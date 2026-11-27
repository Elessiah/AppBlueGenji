import { describe, expect, it } from "@jest/globals";
import { matchesGetiFilter } from "@/lib/shared/geti";
import { GETI_ROBOTS } from "@/lib/shared/geti/page";
import { MIGRATED_ROUTES } from "@/lib/shared/i18n-routes";
import { isMigratedRoute } from "@/lib/shared/locales";
import { localizedSitemapEntries, publicSitemapRoutes } from "@/lib/shared/sitemap";
import { parsedGetiPost } from "@/tests/helpers/geti";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");

/** Annonce dont le seul horaire va de 21 h à 23 h. */
const EVENING = parsedGetiPost({ availability: { days: ["TUE"], times: [{ from: 1260, to: 1380 }], timezone: null } });

describe("matchesGetiFilter — critères de la page (sous-rôle, staff, jour)", () => {
  it("un sous-rôle voulu présent dans l'annonce passe", () => {
    expect(matchesGetiFilter(parsedGetiPost({ subRoles: ["HITSCAN"] }), { subRoles: ["HITSCAN", "FLEX_DPS"] }, NOW)).toBe(true);
  });

  it("un autre sous-rôle est écarté", () => {
    expect(matchesGetiFilter(parsedGetiPost({ subRoles: ["MAIN_TANK"] }), { subRoles: ["HITSCAN"] }, NOW)).toBe(false);
  });

  it("une annonce sans sous-rôle est écartée par défaut", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { subRoles: ["HITSCAN"] }, NOW)).toBe(false);
  });

  it("une annonce sans sous-rôle passe avec includeUnknown", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { subRoles: ["HITSCAN"], includeUnknown: true }, NOW)).toBe(true);
  });

  it("un rôle de staff voulu présent dans l'annonce passe", () => {
    expect(matchesGetiFilter(parsedGetiPost({ staffRoles: ["COACH"] }), { staffRoles: ["COACH"] }, NOW)).toBe(true);
  });

  it("un autre rôle de staff est écarté", () => {
    expect(matchesGetiFilter(parsedGetiPost({ staffRoles: ["CASTER"] }), { staffRoles: ["COACH"] }, NOW)).toBe(false);
  });

  it("un jour voulu présent dans l'annonce passe", () => {
    expect(matchesGetiFilter(EVENING, { days: ["TUE"] }, NOW)).toBe(true);
  });

  it("un autre jour est écarté", () => {
    expect(matchesGetiFilter(EVENING, { days: ["SUN"] }, NOW)).toBe(false);
  });
});

describe("matchesGetiFilter — créneau horaire", () => {
  it("un créneau sans borne ne filtre rien", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { time: { from: null, to: null } }, NOW)).toBe(true);
  });

  it("un créneau qui commence à la fin de l'horaire passe (borne comprise)", () => {
    expect(matchesGetiFilter(EVENING, { time: { from: 1380 } }, NOW)).toBe(true);
  });

  it("un créneau qui commence une minute après la fin est écarté", () => {
    expect(matchesGetiFilter(EVENING, { time: { from: 1381 } }, NOW)).toBe(false);
  });

  it("un créneau qui finit au début de l'horaire passe (borne comprise)", () => {
    expect(matchesGetiFilter(EVENING, { time: { to: 1260 } }, NOW)).toBe(true);
  });

  it("un créneau qui finit une minute avant le début est écarté", () => {
    expect(matchesGetiFilter(EVENING, { time: { to: 1259 } }, NOW)).toBe(false);
  });

  it("une heure seule dans le créneau passe", () => {
    const post = parsedGetiPost({ availability: { days: [], times: [{ from: 1200, to: null }], timezone: null } });

    expect(matchesGetiFilter(post, { time: { from: 1140, to: 1260 } }, NOW)).toBe(true);
  });

  it("une heure seule hors du créneau est écartée", () => {
    const post = parsedGetiPost({ availability: { days: [], times: [{ from: 1200, to: null }], timezone: null } });

    expect(matchesGetiFilter(post, { time: { from: 1260 } }, NOW)).toBe(false);
  });

  it("un horaire qui passe minuit court jusqu'à la fin de la journée", () => {
    const post = parsedGetiPost({ availability: { days: [], times: [{ from: 1320, to: 60 }], timezone: null } });

    expect(matchesGetiFilter(post, { time: { from: 1410 } }, NOW)).toBe(true);
  });

  it("une annonce sans horaire est écartée par défaut", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { time: { from: 1200 } }, NOW)).toBe(false);
  });

  it("une annonce sans horaire passe avec includeUnknown", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { time: { from: 1200 }, includeUnknown: true }, NOW)).toBe(true);
  });
});

describe("page des annonces — référencement", () => {
  it("publicSitemapRoutes_any_listsNoGetiPage", () => {
    expect(publicSitemapRoutes().map((route) => route.path).filter((path) => path.startsWith("/geti-info"))).toEqual([]);
  });

  it("localizedSitemapEntries_any_listsNoEnglishGetiPage", () => {
    const paths = localizedSitemapEntries(publicSitemapRoutes()).map((entry) => entry.path);

    expect(paths.filter((path) => path.includes("/geti-info"))).toEqual([]);
  });

  it("GETI_ROBOTS_always_noindexButFollow", () => {
    expect(GETI_ROBOTS).toEqual({ index: false, follow: true, googleBot: { index: false, follow: true } });
  });

  it("la page et ses catégories sont des routes traduites", () => {
    expect(MIGRATED_ROUTES).toContain("/geti-info");
    expect(isMigratedRoute("/geti-info/lfcast")).toBe(true);
  });
});
