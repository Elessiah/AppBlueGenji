import { describe, expect, it } from "@jest/globals";
import {
  RANKING_GAME_FILTERS,
  RANKING_MAX_SHOWN,
  RANKING_PAGE_SIZE,
  parseRankingFilter,
  parseRankingShown,
  pointsBehind,
  rankingFilterGame,
  rankingFilterHref,
  rankingMoreHref,
  rankingRowId,
} from "@/lib/shared/ranking-page";

describe("filtre de jeu de /classement", () => {
  it("lit ow et mr, sans égard à la casse ni aux espaces", () => {
    expect(parseRankingFilter("ow")).toBe("ow");
    expect(parseRankingFilter(" MR ")).toBe("mr");
  });

  it("rend le général pour une valeur absente, inconnue ou répétée", () => {
    expect(parseRankingFilter(undefined)).toBe("all");
    expect(parseRankingFilter("")).toBe("all");
    expect(parseRankingFilter("valorant")).toBe("all");
    expect(parseRankingFilter(["ow", "mr"])).toBe("all");
  });

  it("associe chaque filtre à son jeu", () => {
    expect(rankingFilterGame("all")).toBeUndefined();
    expect(rankingFilterGame("ow")).toBe("OW");
    expect(rankingFilterGame("mr")).toBe("MR");
  });

  it("donne au général une adresse sans paramètre", () => {
    expect(rankingFilterHref("all")).toBe("/classement");
    expect(rankingFilterHref("ow")).toBe("/classement?jeu=ow");
    expect(RANKING_GAME_FILTERS.map((filter) => rankingFilterHref(filter.id))).toEqual([
      "/classement",
      "/classement?jeu=ow",
      "/classement?jeu=mr",
    ]);
  });
});

describe("écart au rang au-dessus", () => {
  const rows = [{ points: 620 }, { points: 540 }, { points: 540 }];

  it("n'en donne aucun à la première ligne ni hors limites", () => {
    expect(pointsBehind(rows, 0)).toBeNull();
    expect(pointsBehind(rows, 3)).toBeNull();
    expect(pointsBehind([], 0)).toBeNull();
  });

  it("compte les points d'écart, zéro à égalité", () => {
    expect(pointsBehind(rows, 1)).toBe(80);
    expect(pointsBehind(rows, 2)).toBe(0);
  });

  it("ne rend jamais d'écart négatif", () => {
    expect(pointsBehind([{ points: 500 }, { points: 600 }], 1)).toBe(0);
  });
});

describe("affichage progressif (?n=)", () => {
  it("rend la première page sans paramètre ou sur une valeur invalide", () => {
    for (const value of [undefined, "", "abc", "-50", "12.5", "1e3", "0x40", ["100", "150"]]) {
      expect(parseRankingShown(value)).toBe(RANKING_PAGE_SIZE);
    }
  });

  it("arrondit à la page supérieure et borne aux limites", () => {
    expect(parseRankingShown("0")).toBe(50);
    expect(parseRankingShown("1")).toBe(50);
    expect(parseRankingShown(" 100 ")).toBe(100);
    expect(parseRankingShown("101")).toBe(150);
    expect(parseRankingShown("1000")).toBe(RANKING_MAX_SHOWN);
    expect(parseRankingShown("99999")).toBe(RANKING_MAX_SHOWN);
    expect(parseRankingShown("9".repeat(40))).toBe(RANKING_PAGE_SIZE);
  });

  it("garde l'onglet de jeu dans l'adresse de la page suivante, ancrée sur sa première ligne", () => {
    expect(rankingMoreHref("all", 50)).toBe("/classement?n=100#rang-51");
    expect(rankingMoreHref("mr", 100)).toBe("/classement?jeu=mr&n=150#rang-101");
    expect(rankingFilterHref("ow", 50)).toBe("/classement?jeu=ow");
    expect(rankingRowId(51)).toBe("rang-51");
  });

  it("n'offre plus de page suivante une fois le plafond atteint", () => {
    expect(rankingMoreHref("all", RANKING_MAX_SHOWN)).toBeNull();
    expect(rankingMoreHref("all", RANKING_MAX_SHOWN - 10)).toBe(`/classement?n=${RANKING_MAX_SHOWN}#rang-${RANKING_MAX_SHOWN - 9}`);
  });
});
