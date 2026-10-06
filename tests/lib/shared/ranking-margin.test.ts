import { describe, expect, it } from "@jest/globals";
import {
  RANKING_BASE_POINTS,
  RANKING_K_FACTOR,
  RANKING_MARGIN_MAX_BONUS,
  marginMultiplier,
  ratingDrawTransfer,
  ratingTransfer,
  replayRanking,
  type MatchMargin,
  type RankedMatch,
} from "@/lib/shared/ranking";

/**
 * Le score du match pèse sur le transfert : un 3-0 déplace plus de points
 * qu'un 3-2. Le multiplicateur reste borné, symétrique (un seul calcul pour
 * les deux camps) et neutre quand le score ne dit rien.
 */

const score = (winnerMaps: number, loserMaps: number): MatchMargin => ({ winnerMaps, loserMaps });

function match(id: number, winner: number, loser: number, extra: Partial<RankedMatch> = {}): RankedMatch {
  return {
    matchId: id,
    winnerTeamId: winner,
    loserTeamId: loser,
    playedAt: `2026-06-${String(id).padStart(2, "0")}T18:00:00.000Z`,
    ...extra,
  };
}

describe("multiplicateur de score — cotes égales", () => {
  it.each([
    { winner: 3, loser: 0, expected: 1.5 },
    { winner: 3, loser: 1, expected: 1.25 },
    { winner: 3, loser: 2, expected: 1 },
    { winner: 2, loser: 0, expected: 1.5 },
    { winner: 2, loser: 1, expected: 1 },
    { winner: 4, loser: 0, expected: 1.5 },
    { winner: 4, loser: 2, expected: 1 + RANKING_MARGIN_MAX_BONUS / 3 },
  ])("$winner-$loser → ×$expected", ({ winner, loser, expected }) => {
    expect(marginMultiplier(score(winner, loser))).toBeCloseTo(expected, 10);
  });

  it("FT1 (1-0) : une seule map, aucun écart possible → ×1", () => {
    expect(marginMultiplier(score(1, 0))).toBe(1);
  });

  it("sans score (forfait, match ancien) → ×1", () => {
    expect(marginMultiplier(undefined)).toBe(1);
  });

  it.each([
    { label: "vainqueur sans avance", winnerMaps: 2, loserMaps: 2 },
    { label: "vainqueur derrière", winnerMaps: 1, loserMaps: 3 },
    { label: "négatif", winnerMaps: 3, loserMaps: -1 },
    { label: "décimal", winnerMaps: 2.5, loserMaps: 0 },
    { label: "NaN", winnerMaps: Number.NaN, loserMaps: 0 },
    { label: "zéro", winnerMaps: 0, loserMaps: 0 },
  ])("score incohérent ($label) → ×1", ({ winnerMaps, loserMaps }) => {
    expect(marginMultiplier({ winnerMaps, loserMaps })).toBe(1);
  });
});

describe("bornes et amortisseur d'autocorrélation", () => {
  it("reste entre 1 et 1 + bonus maximal, quel que soit l'écart de cote", () => {
    for (const gap of [-2000, -400, 0, 400, 2000]) {
      for (const [w, l] of [[3, 0], [3, 1], [3, 2], [5, 0], [2, 0]]) {
        const value = marginMultiplier(score(w, l), gap);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(1 + RANKING_MARGIN_MAX_BONUS);
      }
    }
  });

  it("amortit le balayage de la favorite (400 pts d'avance → bonus × 2,2/2,6)", () => {
    expect(marginMultiplier(score(3, 0), 400)).toBeCloseTo(1 + 0.5 * (2.2 / 2.6), 10);
  });

  it("laisse entier le balayage de l'outsider", () => {
    expect(marginMultiplier(score(3, 0), -400)).toBe(1.5);
  });

  it("n'amortit pas une victoire serrée : elle reste à ×1", () => {
    expect(marginMultiplier(score(3, 2), 800)).toBe(1);
  });
});

describe("transfert majoré", () => {
  it("cotes égales : 3-0 → 24, 3-1 → 20, 3-2 → 16 (le transfert d'avant)", () => {
    expect(ratingTransfer(500, 500, score(3, 0))).toBe(24);
    expect(ratingTransfer(500, 500, score(3, 1))).toBe(20);
    expect(ratingTransfer(500, 500, score(3, 2))).toBe(16);
    expect(ratingTransfer(500, 500)).toBe(RANKING_K_FACTOR / 2);
  });

  it("outsider 500 qui balaie 900 : 29 → 44", () => {
    expect(ratingTransfer(500, 900)).toBe(29);
    expect(ratingTransfer(500, 900, score(3, 0))).toBe(44);
  });

  it("favorite 900 qui balaie 500 : 3 → 4 (amorti)", () => {
    expect(ratingTransfer(900, 500)).toBe(3);
    expect(ratingTransfer(900, 500, score(3, 0))).toBe(4);
  });

  it("le nul ne regarde pas le score", () => {
    const drawn = replayRanking([match(1, 1, 2, { drawn: true, score: score(3, 0) })]);
    const expected = ratingDrawTransfer(RANKING_BASE_POINTS, RANKING_BASE_POINTS);
    expect(drawn.get(1)?.points).toBe(RANKING_BASE_POINTS - expected);
    expect(drawn.get(1)?.draws).toBe(1);
  });
});

describe("rejeu avec score", () => {
  it("un 3-0 déplace plus qu'un 3-2, à somme nulle", () => {
    const sweep = replayRanking([match(1, 1, 2, { score: score(3, 0) })]);
    const tight = replayRanking([match(1, 1, 2, { score: score(3, 2) })]);
    expect(sweep.get(1)?.points).toBe(524);
    expect(sweep.get(2)?.points).toBe(476);
    expect(tight.get(1)?.points).toBe(516);
    expect(tight.get(2)?.points).toBe(484);
  });

  it("conserve le total du site sur une série de matchs aux scores variés", () => {
    const matches = [
      match(1, 1, 2, { score: score(3, 0) }),
      match(2, 3, 4, { score: score(3, 1) }),
      match(3, 1, 3, { score: score(2, 1) }),
      match(4, 4, 2, { score: score(2, 0) }),
      match(5, 2, 1, { score: score(3, 0) }),
      match(6, 3, 2),
    ];
    const states = replayRanking(matches);
    const total = [...states.values()].reduce((sum, state) => sum + state.points, 0);
    expect(total).toBe(4 * RANKING_BASE_POINTS);
  });

  it("un match sans score (forfait, ancien) rejoue le transfert d'avant", () => {
    const states = replayRanking([match(1, 1, 2)]);
    expect(states.get(1)?.points).toBe(RANKING_BASE_POINTS + 16);
  });

  it("est déterministe, quel que soit l'ordre reçu", () => {
    const matches = [
      match(1, 1, 2, { score: score(3, 0) }),
      match(2, 2, 3, { score: score(3, 1) }),
      match(3, 3, 1, { score: score(2, 0) }),
    ];
    const forward = replayRanking(matches);
    const backward = replayRanking([...matches].reverse());
    expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
  });
});
