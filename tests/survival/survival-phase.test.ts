import { describe, expect, it } from "@jest/globals";
import {
  computeFinalRanks,
  replaySurvival,
  shouldEliminateBarrageLoser,
  teamsToEliminate,
  type SurvivalMatchOutcome,
} from "@/lib/shared/survival";

const teams = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ teamId: i + 1, seed: i + 1 }));

const match = (
  round: number,
  winnerTeamId: number | null,
  loserTeamId: number | null,
  overrides: Partial<SurvivalMatchOutcome> = {},
): SurvivalMatchOutcome => ({
  round,
  completed: true,
  winnerTeamId,
  loserTeamId,
  isBye: false,
  ...overrides,
});

const statusOf = (standings: ReturnType<typeof replaySurvival>, teamId: number) =>
  standings.find((s) => s.teamId === teamId)!;

describe("teamsToEliminate — avec plusieurs équipes cibles (phases qualificatives)", () => {
  it("n'élimine rien quand on est au-dessus du seuil", () => {
    expect(teamsToEliminate(5, 3)).toBe(0);
    expect(teamsToEliminate(3, 3)).toBe(0);
  });

  it("élimine une seule équipe quand on passe du seuil", () => {
    expect(teamsToEliminate(4, 3)).toBe(1);
  });

  it("élimine deux équipes en effectif pair", () => {
    expect(teamsToEliminate(6, 3)).toBe(2);
  });

  it("élimine une seule équipe en effectif impair (équilibrage)", () => {
    expect(teamsToEliminate(7, 3)).toBe(1);
  });

  it("reste conforme à targetTeams = 1 (comportement nominal)", () => {
    // Les tests existants ont targetTeams = 1 par défaut
    expect(teamsToEliminate(4, 1)).toBe(1);
    expect(teamsToEliminate(6, 1)).toBe(2);
    expect(teamsToEliminate(5, 1)).toBe(1);
    expect(teamsToEliminate(1, 1)).toBe(0);
  });
});

describe("shouldEliminateBarrageLoser — avec plusieurs équipes cibles", () => {
  it("élimine le perdant du barrage si l'effectif impair dépasse le seuil", () => {
    expect(shouldEliminateBarrageLoser(5, 3)).toBe(true);
  });

  it("n'élimine pas si on est au seuil", () => {
    expect(shouldEliminateBarrageLoser(3, 3)).toBe(false);
  });

  it("n'élimine pas un effectif pair", () => {
    expect(shouldEliminateBarrageLoser(4, 3)).toBe(false);
  });

  it("reste conforme à targetTeams = 1", () => {
    expect(shouldEliminateBarrageLoser(5, 1)).toBe(true);
    expect(shouldEliminateBarrageLoser(3, 1)).toBe(true);
    expect(shouldEliminateBarrageLoser(2, 1)).toBe(false);
    expect(shouldEliminateBarrageLoser(1, 1)).toBe(false);
  });
});

describe("replaySurvival — phases qualificatives (targetTeams > 1)", () => {
  it("n'élimine rien quand le seuil est atteint", () => {
    const standings = replaySurvival({
      teams: teams(8),
      matches: [
        match(1, 1, 8),
        match(1, 2, 7),
        match(1, 3, 6),
        match(1, 4, 5),
      ],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 1,
      targetTeams: 4,
    });

    const active = standings.filter((s) => s.status === "ACTIVE");
    expect(active).toHaveLength(4);
    expect(standings.filter((s) => s.status === "ELIMINATED")).toHaveLength(0);
  });

  it("élimite jusqu'au seuil sans jamais le dépasser", () => {
    const standings = replaySurvival({
      teams: teams(10),
      matches: [
        // Round 1 : tout le monde joue
        match(1, 1, 10),
        match(1, 2, 9),
        match(1, 3, 8),
        match(1, 4, 7),
        match(1, 5, 6),
      ],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 1,
      targetTeams: 4,
    });

    // 10 → 8 actifs (2 éliminés) → 6 (2 de plus) → ne devrait pas descendre à 4
    // Mais on n'a qu'un seul round : il n'y a qu'une seule coupe au round 1
    const active = standings.filter((s) => s.status === "ACTIVE");
    expect(active.length).toBeGreaterThanOrEqual(4);
  });

  it("s'arrête d'éliminer une fois le seuil atteint sur plusieurs rounds", () => {
    const standings = replaySurvival({
      teams: teams(12),
      matches: [
        // Round 1 : 6 matchs, coupe après
        match(1, 1, 12),
        match(1, 2, 11),
        match(1, 3, 10),
        match(1, 4, 9),
        match(1, 5, 8),
        match(1, 6, 7),
        // Round 2 : nouveaux classements, coupe si besoin
        match(2, 1, 2),
        match(2, 3, 4),
        match(2, 5, 6),
      ],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 2,
      targetTeams: 4,
    });

    const active = standings.filter((s) => s.status === "ACTIVE");
    expect(active.length).toBe(4);
    expect(standings.filter((s) => s.status === "ELIMINATED").length).toBe(8);
  });

  it("gère les abandons en maintenant le seuil", () => {
    const standings = replaySurvival({
      teams: teams(8),
      matches: [match(1, 1, 8), match(1, 2, 7), match(1, 3, 6), match(1, 4, 5)],
      forfeits: [{ teamId: 2, round: 1 }],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 1,
      targetTeams: 4,
    });

    const active = standings.filter((s) => s.status === "ACTIVE");
    expect(active).toHaveLength(4);
    expect(statusOf(standings, 2).status).toBe("FORFEIT");
  });
});

describe("replaySurvival — retrocompatibilité avec targetTeams = 1 (défaut)", () => {
  it("se comporte identiquement quand targetTeams n'est pas fourni", () => {
    const base = {
      teams: teams(6),
      matches: [match(1, 1, 6), match(1, 2, 5), match(1, 3, 4)],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 1,
    };

    const withDefault = replaySurvival(base);
    const withExplicit = replaySurvival({ ...base, targetTeams: 1 });

    expect(withDefault).toEqual(withExplicit);
  });

  it("applique les mêmes coupes que les tests existants (targetTeams = 1)", () => {
    const standings = replaySurvival({
      teams: teams(6),
      matches: [match(1, 1, 6), match(1, 2, 5), match(1, 3, 4)],
      forfeits: [],
      roundsBeforeFirstCut: 2,
      roundsPerCut: 2,
      barrageRounds: 0,
      lastRound: 1,
      targetTeams: 1,
    });

    // Pas de coupe au round 1 (cadence au round 2)
    expect(standings.every((s) => s.status === "ACTIVE")).toBe(true);
  });
});

describe("computeFinalRanks — les survivants devant les éliminés", () => {
  it("classe les équipes actives avant les éliminées", () => {
    const standings = replaySurvival({
      teams: teams(6),
      matches: [
        match(1, 1, 6),
        match(1, 2, 5),
        match(1, 3, 4),
        match(2, 1, 2),
        match(2, 3, 5),
      ],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 2,
      targetTeams: 2,
    });

    const ranks = computeFinalRanks(standings);
    const active = standings.filter((s) => s.status === "ACTIVE");
    const eliminated = standings.filter((s) => s.status !== "ACTIVE");

    const maxActiveRank = Math.max(...active.map((s) => ranks.get(s.teamId)!));
    const minEliminatedRank = Math.min(...eliminated.map((s) => ranks.get(s.teamId)!));

    expect(maxActiveRank).toBeLessThan(minEliminatedRank);
  });

  it("classe les éliminés par round d'élimination décroissant, puis standing", () => {
    const standings = replaySurvival({
      teams: teams(8),
      matches: [
        match(1, 1, 8),
        match(1, 2, 7),
        match(1, 3, 6),
        match(1, 4, 5),
        match(2, 1, 2),
        match(2, 3, 4),
      ],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 2,
      targetTeams: 2,
    });

    const ranks = computeFinalRanks(standings);

    // Les équipes éliminées au round 2 (3, 4) devraient être mieux classées
    // que celles éliminées au round 1 (5, 6, 7, 8)
    const roundTwoElim = [3, 4];
    const roundOneElim = [5, 6, 7, 8];

    for (const t2 of roundTwoElim) {
      for (const t1 of roundOneElim) {
        expect(ranks.get(t2)!).toBeLessThan(ranks.get(t1)!);
      }
    }
  });
});
