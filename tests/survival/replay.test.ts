import { describe, expect, it } from "@jest/globals";
import {
  isCutRound,
  nextCutRound,
  planSurvivalRound,
  rankActiveTeams,
  replaySurvival,
  samePairings,
  type SurvivalMatchOutcome,
} from "@/lib/shared/survival";
import { rankingPoints, rankingPointsSql } from "@/lib/shared/ranking";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("replaySurvival — dérivation depuis l'historique", () => {
  it("compte victoires et défaites des matchs terminés", () => {
    const standings = replaySurvival({
      teams: teams(4),
      matches: [match(1, 1, 2), match(1, 3, 4)],
      forfeits: [],
      roundsBeforeFirstCut: 2,
      roundsPerCut: 2,
      barrageRounds: 0,
      lastRound: 1,
    });

    expect(statusOf(standings, 1).wins).toBe(1);
    expect(statusOf(standings, 2).losses).toBe(1);
    expect(standings.every((s) => s.status === "ACTIVE")).toBe(true);
  });

  it("ignore un match non terminé", () => {
    const standings = replaySurvival({
      teams: teams(4),
      matches: [match(1, 1, 2), match(1, 3, 4, { completed: false, winnerTeamId: 3, loserTeamId: 4 })],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 1,
    });

    expect(statusOf(standings, 3).wins).toBe(0);
    // Round incomplet : aucune coupe appliquée
    expect(standings.every((s) => s.status === "ACTIVE")).toBe(true);
  });

  it("marque la victoire d'office comme victoire et interdit un second bye", () => {
    const standings = replaySurvival({
      teams: teams(3),
      matches: [match(1, 1, 2), match(1, 3, null, { isBye: true })],
      forfeits: [],
      roundsBeforeFirstCut: 5,
      roundsPerCut: 5,
      barrageRounds: 0,
      lastRound: 1,
    });

    expect(statusOf(standings, 3).wins).toBe(1);
    expect(statusOf(standings, 3).hasBye).toBe(true);
    expect(statusOf(standings, 1).hasBye).toBe(false);
  });

  it("applique la coupe au round de cadence", () => {
    const standings = replaySurvival({
      teams: teams(6),
      matches: [match(1, 1, 6), match(1, 2, 5), match(1, 3, 4)],
      forfeits: [],
      roundsBeforeFirstCut: 1,
      roundsPerCut: 1,
      barrageRounds: 0,
      lastRound: 1,
    });

    const eliminated = standings.filter((s) => s.status === "ELIMINATED").map((s) => s.teamId);
    expect(eliminated).toHaveLength(2);
    // Les deux dernières du classement courant (0 victoire, seed le plus haut)
    expect(eliminated.sort()).toEqual([5, 6]);
    expect(statusOf(standings, 5).eliminatedRound).toBe(1);
  });

  it("élimine le perdant du barrage quand l'effectif est impair", () => {
    const standings = replaySurvival({
      teams: teams(5),
      matches: [match(1, 4, 5)],
      forfeits: [],
      roundsBeforeFirstCut: 2,
      roundsPerCut: 2,
      barrageRounds: 1,
      lastRound: 1,
    });

    expect(statusOf(standings, 5).status).toBe("ELIMINATED");
    expect(statusOf(standings, 5).eliminatedRound).toBe(1);
    expect(rankActiveTeams(standings)).toHaveLength(4);
  });

  it("conserve les abandons, qui ne se déduisent pas des matchs", () => {
    const standings = replaySurvival({
      teams: teams(4),
      matches: [match(1, 1, 2)],
      forfeits: [{ teamId: 3, round: 1 }],
      roundsBeforeFirstCut: 5,
      roundsPerCut: 5,
      barrageRounds: 0,
      lastRound: 1,
    });

    expect(statusOf(standings, 3).status).toBe("FORFEIT");
    expect(statusOf(standings, 3).eliminatedRound).toBe(1);
  });
});

describe("replaySurvival — correction d'un score déjà pris en compte", () => {
  // Scénario de la régression : la coupe du round 2 avait éliminé l'équipe 4 ;
  // un arbitre corrige le résultat de son match, elle devient gagnante.
  const base = {
    teams: teams(6),
    forfeits: [],
    roundsBeforeFirstCut: 2,
    roundsPerCut: 2,
    barrageRounds: 0,
    lastRound: 2,
  };
  const round1 = [match(1, 1, 6), match(1, 2, 5), match(1, 3, 4)];

  it("élimine les deux dernières avec le score initial", () => {
    const standings = replaySurvival({
      ...base,
      matches: [...round1, match(2, 1, 2), match(2, 3, 6), match(2, 5, 4)],
    });

    const eliminated = standings.filter((s) => s.status === "ELIMINATED").map((s) => s.teamId);
    expect(eliminated.sort()).toEqual([4, 6]);
  });

  it("défait la coupe quand le score corrigé change le classement", () => {
    // Même historique, mais l'équipe 4 gagne finalement son match du round 2.
    const standings = replaySurvival({
      ...base,
      matches: [...round1, match(2, 1, 2), match(2, 3, 6), match(2, 4, 5)],
    });

    expect(statusOf(standings, 4).status).toBe("ACTIVE");
    expect(statusOf(standings, 5).status).toBe("ELIMINATED");
    const eliminated = standings.filter((s) => s.status === "ELIMINATED").map((s) => s.teamId);
    expect(eliminated.sort()).toEqual([5, 6]);
  });

  it("reste stable si on rejoue deux fois le même historique", () => {
    const input = { ...base, matches: [...round1, match(2, 1, 2), match(2, 3, 6), match(2, 5, 4)] };
    expect(replaySurvival(input)).toEqual(replaySurvival(input));
  });
});

describe("samePairings", () => {
  const plan = (pairs: [number, number][], byeTeamId: number | null = null) => ({
    pairings: pairs.map(([teamAId, teamBId]) => ({ teamAId, teamBId })),
    byeTeamId,
    isBarrage: false,
  });

  it("ignore l'ordre des paires et des équipes", () => {
    expect(samePairings(plan([[1, 2], [3, 4]]), plan([[4, 3], [2, 1]]))).toBe(true);
  });

  it("distingue des appariements différents", () => {
    expect(samePairings(plan([[1, 2], [3, 4]]), plan([[1, 3], [2, 4]]))).toBe(false);
  });

  it("tient compte de la victoire d'office", () => {
    expect(samePairings(plan([[1, 2]], 3), plan([[1, 2]], 4))).toBe(false);
    expect(samePairings(plan([[1, 2]], 3), plan([[1, 2]], 3))).toBe(true);
  });

  it("détecte qu'un round devient périmé après un reclassement", () => {
    const before = planSurvivalRound(
      rankActiveTeams(
        replaySurvival({
          teams: teams(4),
          matches: [match(1, 1, 2), match(1, 3, 4)],
          forfeits: [],
          roundsBeforeFirstCut: 5,
          roundsPerCut: 5,
          barrageRounds: 0,
          lastRound: 1,
        }),
      ),
    );
    const after = planSurvivalRound(
      rankActiveTeams(
        replaySurvival({
          teams: teams(4),
          matches: [match(1, 2, 1), match(1, 3, 4)],
          forfeits: [],
          roundsBeforeFirstCut: 5,
          roundsPerCut: 5,
          barrageRounds: 0,
          lastRound: 1,
        }),
      ),
    );
    expect(samePairings(before, after)).toBe(false);
  });
});

describe("barème de classement partagé", () => {
  it("pénalise les défaites", () => {
    expect(rankingPoints(3, 0)).toBeGreaterThan(rankingPoints(3, 5));
    expect(rankingPoints(0, 10)).toBeLessThan(0);
    // Une équipe qui gagne passe devant une équipe qui accumule les défaites.
    expect(rankingPoints(3, 0)).toBeGreaterThan(rankingPoints(0, 10));
  });

  it("expose la même formule en SQL", () => {
    expect(rankingPointsSql("w", "l")).toBe("((w) * 100 + (l) * -20)");
  });

  it("est utilisé par le leaderboard du site et par le seeding Survie", () => {
    const root = join(__dirname, "..", "..");
    const read = (path: string) => readFileSync(join(root, path), "utf8");

    // Le leaderboard ne calcule plus rien lui-même : il lit le classement du
    // site, seul endroit où le barème est appliqué.
    const landing = read("lib/server/landing-service.ts");
    expect(landing).toContain("loadTeamRanking");
    expect(landing).not.toContain("SUM(CASE WHEN m.winner_team_id");
    expect(landing).not.toMatch(/wins \* 100 - losses \* 20/);

    // Le seeding compose lui aussi le barème par l'assembleur partagé, sans
    // réécrire ses propres agrégats.
    const survival = read("lib/server/tournaments/survival.ts");
    expect(survival).toContain("rankingPointsForTeamSql");
    expect(survival).not.toContain("SUM(CASE WHEN m.winner_team_id");
    // L'ancien barème (les défaites rapportaient des points) doit avoir disparu.
    expect(survival).not.toContain("* 3");
  });
});

describe("cadence en deux temps — première coupe puis intervalle", () => {
  const schedule = { roundsBeforeFirstCut: 4, roundsPerCut: 2 };

  it("attend la première coupe le temps demandé", () => {
    for (const round of [1, 2, 3]) {
      expect(isCutRound(round, schedule)).toBe(false);
    }
    expect(isCutRound(4, schedule)).toBe(true);
  });

  it("enchaîne ensuite au rythme de l'intervalle", () => {
    expect(isCutRound(5, schedule)).toBe(false);
    expect(isCutRound(6, schedule)).toBe(true);
    expect(isCutRound(8, schedule)).toBe(true);
    expect(isCutRound(9, schedule)).toBe(false);
  });

  it("reste compatible quand les deux valeurs sont égales", () => {
    const uniform = { roundsBeforeFirstCut: 3, roundsPerCut: 3 };
    for (const round of [3, 6, 9]) expect(isCutRound(round, uniform)).toBe(true);
    for (const round of [1, 2, 4, 5]) expect(isCutRound(round, uniform)).toBe(false);
  });

  it("décale tout du barrage", () => {
    const withBarrage = { ...schedule, barrageRounds: 1 };
    expect(isCutRound(4, withBarrage)).toBe(false);
    expect(isCutRound(5, withBarrage)).toBe(true); // 1 barrage + 4 manches
    expect(isCutRound(7, withBarrage)).toBe(true);
  });

  it("permet une première coupe plus tardive que l'intervalle, et l'inverse", () => {
    const tardive = { roundsBeforeFirstCut: 5, roundsPerCut: 1 };
    expect(isCutRound(4, tardive)).toBe(false);
    expect(isCutRound(5, tardive)).toBe(true);
    expect(isCutRound(6, tardive)).toBe(true);

    const precoce = { roundsBeforeFirstCut: 1, roundsPerCut: 3 };
    expect(isCutRound(1, precoce)).toBe(true);
    expect(isCutRound(2, precoce)).toBe(false);
    expect(isCutRound(4, precoce)).toBe(true);
  });

  it("élimine à la manche demandée, pas avant", () => {
    const teams4 = [1, 2, 3, 4].map((teamId) => ({ teamId, seed: teamId }));
    const rounds = [
      match(1, 1, 2), match(1, 3, 4),
      match(2, 1, 3), match(2, 2, 4),
    ];
    const input = {
      teams: teams4,
      forfeits: [],
      roundsBeforeFirstCut: 3,
      roundsPerCut: 1,
      barrageRounds: 0,
    };

    // Round 2 : la première coupe n'est pas encore due.
    expect(
      replaySurvival({ ...input, matches: rounds, lastRound: 2 }).every(
        (s) => s.status === "ACTIVE",
      ),
    ).toBe(true);

    // Round 3 : elle tombe.
    const after = replaySurvival({
      ...input,
      matches: [...rounds, match(3, 1, 4), match(3, 2, 3)],
      lastRound: 3,
    });
    expect(after.filter((s) => s.status === "ELIMINATED")).toHaveLength(2);
  });
});

describe("nextCutRound — échéance annoncée", () => {
  const schedule = { roundsBeforeFirstCut: 4, roundsPerCut: 2 };

  it("pointe la première coupe tant qu'elle n'est pas passée", () => {
    for (const round of [1, 2, 3, 4]) {
      expect(nextCutRound(round, schedule)).toBe(4);
    }
  });

  it("pointe ensuite la suivante", () => {
    expect(nextCutRound(5, schedule)).toBe(6);
    expect(nextCutRound(6, schedule)).toBe(6);
    expect(nextCutRound(7, schedule)).toBe(8);
  });

  it("tient compte du barrage", () => {
    expect(nextCutRound(1, { ...schedule, barrageRounds: 1 })).toBe(5);
  });
});
