import { describe, expect, it } from "@jest/globals";
import { matchesGetiFilter, type GetiFilter } from "@/lib/shared/geti";
import { getiRange, getiRank, parsedGetiPost } from "@/tests/helpers/geti";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const D3 = getiRank("DIAMOND", 3);
const M2 = getiRank("MASTER", 2);
/** Annonce dont la fourchette globale va de Diamant 3 à Master 2. */
const D3_TO_M2 = parsedGetiPost({ ranks: { min: D3, max: M2, byRole: {} } });

describe("matchesGetiFilter — filtre vide et catégorie", () => {
  it("un filtre vide laisse tout passer", () => {
    expect(matchesGetiFilter(parsedGetiPost(), {}, NOW)).toBe(true);
  });

  it("des critères nuls ou des listes vides ne filtrent rien", () => {
    const filter: GetiFilter = { category: null, ranks: null, roles: [], regions: null, platforms: [], languages: null, maxAgeHours: null };

    expect(matchesGetiFilter(parsedGetiPost(), filter, NOW)).toBe(true);
  });

  it("la catégorie voulue passe", () => {
    expect(matchesGetiFilter(parsedGetiPost({ category: "lfp" }), { category: "lfp" }, NOW)).toBe(true);
  });

  it("une autre catégorie est écartée", () => {
    expect(matchesGetiFilter(parsedGetiPost({ category: "lft" }), { category: "lfp" }, NOW)).toBe(false);
  });

  it("une annonce sans catégorie est écartée d'un filtre par catégorie, même avec includeUnknown", () => {
    const filter: GetiFilter = { category: "lfp", includeUnknown: true };

    expect(matchesGetiFilter(parsedGetiPost({ category: null }), filter, NOW)).toBe(false);
  });
});

describe("matchesGetiFilter — âge de l'annonce", () => {
  it("une annonce publiée exactement à la limite passe", () => {
    const post = parsedGetiPost({ postedAt: "2026-11-26T12:00:00.000Z" });

    expect(matchesGetiFilter(post, { maxAgeHours: 24 }, NOW)).toBe(true);
  });

  it("une milliseconde au-delà de la limite, elle est écartée", () => {
    const post = parsedGetiPost({ postedAt: "2026-11-26T11:59:59.999Z" });

    expect(matchesGetiFilter(post, { maxAgeHours: 24 }, NOW)).toBe(false);
  });

  it("une annonce sans date est écartée d'un filtre par âge", () => {
    expect(matchesGetiFilter(parsedGetiPost({ postedAt: null }), { maxAgeHours: 24 }, NOW)).toBe(false);
  });

  it("une date illisible est écartée d'un filtre par âge", () => {
    expect(matchesGetiFilter(parsedGetiPost({ postedAt: "hier" }), { maxAgeHours: 24 }, NOW)).toBe(false);
  });

  it("un âge maximal nul, négatif ou non fini ne filtre rien", () => {
    const old = parsedGetiPost({ postedAt: "2020-01-01T00:00:00.000Z" });

    expect(matchesGetiFilter(old, { maxAgeHours: 0 }, NOW)).toBe(true);
    expect(matchesGetiFilter(old, { maxAgeHours: -5 }, NOW)).toBe(true);
    expect(matchesGetiFilter(old, { maxAgeHours: Number.NaN }, NOW)).toBe(true);
  });

  it("sans instant de référence, l'heure courante sert", () => {
    const post = parsedGetiPost({ postedAt: new Date().toISOString() });

    expect(matchesGetiFilter(post, { maxAgeHours: 1 })).toBe(true);
  });
});

describe("matchesGetiFilter — rôles", () => {
  it("un rôle voulu présent dans l'annonce passe", () => {
    expect(matchesGetiFilter(parsedGetiPost({ roles: ["TANK", "DPS"] }), { roles: ["DPS", "SUPPORT"] }, NOW)).toBe(true);
  });

  it("aucun rôle voulu dans l'annonce : écartée", () => {
    expect(matchesGetiFilter(parsedGetiPost({ roles: ["TANK"] }), { roles: ["SUPPORT"] }, NOW)).toBe(false);
  });

  it("une annonce « Flex » passe tout filtre de rôle", () => {
    expect(matchesGetiFilter(parsedGetiPost({ roles: ["FLEX"] }), { roles: ["TANK"] }, NOW)).toBe(true);
  });

  it("le rôle voulu « Flex » ne retient pas une annonce d'un seul rôle", () => {
    expect(matchesGetiFilter(parsedGetiPost({ roles: ["TANK"] }), { roles: ["FLEX"] }, NOW)).toBe(false);
  });

  it("sans rôle lu, l'annonce est écartée par défaut", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { roles: ["TANK"] }, NOW)).toBe(false);
  });

  it("sans rôle lu, elle passe avec includeUnknown", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { roles: ["TANK"], includeUnknown: true }, NOW)).toBe(true);
  });
});

describe("matchesGetiFilter — rangs", () => {
  it("le minimum voulu égal au haut de l'annonce passe", () => {
    expect(matchesGetiFilter(D3_TO_M2, { ranks: { min: M2 } }, NOW)).toBe(true);
  });

  it("le minimum voulu une division au-dessus du haut de l'annonce l'écarte", () => {
    expect(matchesGetiFilter(D3_TO_M2, { ranks: { min: getiRank("MASTER", 1) } }, NOW)).toBe(false);
  });

  it("le maximum voulu égal au bas de l'annonce passe", () => {
    expect(matchesGetiFilter(D3_TO_M2, { ranks: { max: D3 } }, NOW)).toBe(true);
  });

  it("le maximum voulu une division sous le bas de l'annonce l'écarte", () => {
    expect(matchesGetiFilter(D3_TO_M2, { ranks: { max: getiRank("DIAMOND", 4) } }, NOW)).toBe(false);
  });

  it("une fourchette voulue qui recoupe celle de l'annonce passe", () => {
    const filter = { ranks: { min: getiRank("PLATINUM", 1), max: getiRank("DIAMOND", 1) } };

    expect(matchesGetiFilter(D3_TO_M2, filter, NOW)).toBe(true);
  });

  it("avec un rôle voulu, c'est le rang de ce rôle qui compte", () => {
    const post = parsedGetiPost({
      roles: ["TANK", "DPS"],
      ranks: {
        min: getiRank("DIAMOND", 1),
        max: M2,
        byRole: { TANK: getiRange(M2), DPS: getiRange(getiRank("DIAMOND", 1)) },
      },
    });
    const masterOrMore = { min: getiRank("MASTER", 5) };

    expect(matchesGetiFilter(post, { roles: ["DPS"], ranks: masterOrMore }, NOW)).toBe(false);
    expect(matchesGetiFilter(post, { roles: ["TANK"], ranks: masterOrMore }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { ranks: masterOrMore }, NOW)).toBe(true);
  });

  it("avec un rôle voulu sans rang propre, la fourchette globale sert", () => {
    const post = parsedGetiPost({ roles: ["TANK"], ranks: { min: D3, max: M2, byRole: {} } });

    expect(matchesGetiFilter(post, { roles: ["TANK"], ranks: { min: M2 } }, NOW)).toBe(true);
  });

  it("le rôle voulu « Flex » compare la fourchette globale", () => {
    const post = parsedGetiPost({ roles: ["FLEX"], ranks: { min: D3, max: M2, byRole: {} } });

    expect(matchesGetiFilter(post, { roles: ["FLEX"], ranks: { max: D3 } }, NOW)).toBe(true);
  });

  it("sans rang lu, l'annonce est écartée par défaut", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { ranks: { min: D3 } }, NOW)).toBe(false);
  });

  it("sans rang lu, elle passe avec includeUnknown", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { ranks: { min: D3 }, includeUnknown: true }, NOW)).toBe(true);
  });

  it("des bornes de rang nulles ne filtrent rien", () => {
    expect(matchesGetiFilter(parsedGetiPost(), { ranks: { min: null, max: null } }, NOW)).toBe(true);
  });
});

describe("matchesGetiFilter — région, plateforme, langue", () => {
  it("une région voulue présente passe, absente écarte", () => {
    const post = parsedGetiPost({ regions: ["EU"] });

    expect(matchesGetiFilter(post, { regions: ["NA", "EU"] }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { regions: ["NA"] }, NOW)).toBe(false);
  });

  it("une plateforme voulue présente passe, absente écarte", () => {
    const post = parsedGetiPost({ platforms: ["CONSOLE"] });

    expect(matchesGetiFilter(post, { platforms: ["CONSOLE"] }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { platforms: ["PC"] }, NOW)).toBe(false);
  });

  it("une langue voulue présente passe, absente écarte", () => {
    const post = parsedGetiPost({ languages: ["FR", "EN"] });

    expect(matchesGetiFilter(post, { languages: ["EN"] }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { languages: ["DE"] }, NOW)).toBe(false);
  });

  it("un champ non lu écarte par défaut et passe avec includeUnknown", () => {
    const post = parsedGetiPost();

    expect(matchesGetiFilter(post, { regions: ["EU"] }, NOW)).toBe(false);
    expect(matchesGetiFilter(post, { regions: ["EU"], includeUnknown: true }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { platforms: ["PC"], includeUnknown: true }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { languages: ["FR"], includeUnknown: true }, NOW)).toBe(true);
  });

  it("tous les critères doivent passer ensemble", () => {
    const post = parsedGetiPost({ category: "lft", roles: ["DPS"], regions: ["EU"], platforms: ["PC"] });

    expect(matchesGetiFilter(post, { category: "lft", roles: ["DPS"], regions: ["EU"], platforms: ["PC"] }, NOW)).toBe(true);
    expect(matchesGetiFilter(post, { category: "lft", roles: ["DPS"], regions: ["EU"], platforms: ["CONSOLE"] }, NOW)).toBe(
      false,
    );
  });
});
