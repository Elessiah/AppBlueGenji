import { describe, expect, it } from "@jest/globals";
import {
  RANKING_GAME_FILTERS,
  parseRankingFilter,
  pointsBehind,
  rankingFilterGame,
  rankingFilterHref,
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
