import { describe, expect, it } from "@jest/globals";
import { buildEntrantLogoMap, entrantLogoUrl } from "@/lib/shared/entrant-logos";

/**
 * Table des logos des engagés d'un tournoi.
 *
 * Construite une fois depuis les inscrites, elle sert toutes les vues du
 * plateau : ce qu'elle retient est donc ce que la page entière affichera.
 */
describe("buildEntrantLogoMap", () => {
  it("retient le logo servi par le site de chaque inscrite", () => {
    const logos = buildEntrantLogoMap([
      { teamId: 1, logoUrl: "/api/uploads/teams/a.webp" },
      { teamId: 2, logoUrl: "/uploads/teams/b.webp" },
    ]);

    expect(logos).toEqual({
      1: "/api/uploads/teams/a.webp",
      2: "/uploads/teams/b.webp",
    });
  });

  it("n'a pas d'entrée pour une inscrite sans logo", () => {
    // L'absence de clé *est* le « pas de logo » : l'écran retombe sur l'initiale.
    const logos = buildEntrantLogoMap([
      { teamId: 1, logoUrl: null },
      { teamId: 2, logoUrl: "" },
    ]);

    expect(logos).toEqual({});
  });

  it("écarte une origine étrangère, même si elle arrive jusqu'ici", () => {
    // `next/image` lève au rendu sur un hôte absent de `remotePatterns` : une
    // seule URL tierce ferait tomber la page du tournoi entière.
    const logos = buildEntrantLogoMap([
      { teamId: 1, logoUrl: "https://placehold.co/128x128/png" },
      { teamId: 2, logoUrl: "//cdn.exemple.invalid/logo.png" },
      { teamId: 3, logoUrl: "javascript:alert(1)" },
    ]);

    expect(logos).toEqual({});
  });

  it("rend une table vide pour un tournoi sans inscrite", () => {
    expect(buildEntrantLogoMap([])).toEqual({});
  });
});

describe("entrantLogoUrl", () => {
  const logos = buildEntrantLogoMap([{ teamId: 7, logoUrl: "/api/uploads/teams/g.webp" }]);

  it("rend le logo d'un engagé connu", () => {
    expect(entrantLogoUrl(logos, 7)).toBe("/api/uploads/teams/g.webp");
  });

  it("rend null pour un engagé sans logo ou inconnu", () => {
    expect(entrantLogoUrl(logos, 8)).toBeNull();
    expect(entrantLogoUrl({}, 7)).toBeNull();
  });

  it("rend null pour une case vide (TBD, exemption)", () => {
    expect(entrantLogoUrl(logos, null)).toBeNull();
  });

  it("ne lit pas les propriétés héritées de l'objet", () => {
    // Une table indexée par nombre reste un objet : sans garde, une clé comme
    // `constructor` rendrait une fonction là où l'on attend une URL.
    expect(entrantLogoUrl(logos, "constructor" as unknown as number)).toBeNull();
  });
});
