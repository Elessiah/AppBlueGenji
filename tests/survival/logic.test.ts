import { describe, it, expect } from "@jest/globals";
import {
  compareStanding,
  computeFinalRanks,
  isCutRound,
  planSurvivalRound,
  rankActiveTeams,
  selectEliminatedTeamIds,
  teamsToEliminate,
  type SurvivalStanding,
} from "@/lib/shared/survival";

function team(overrides: Partial<SurvivalStanding> & { teamId: number }): SurvivalStanding {
  return {
    seed: overrides.teamId,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    hasBye: false,
    ...overrides,
  };
}

describe("survival — compareStanding / rankActiveTeams", () => {
  it("classe par victoires desc, défaites asc, puis seed asc", () => {
    const a = team({ teamId: 1, seed: 3, wins: 2, losses: 1 });
    const b = team({ teamId: 2, seed: 1, wins: 2, losses: 1 });
    const c = team({ teamId: 3, seed: 2, wins: 3, losses: 0 });
    const d = team({ teamId: 4, seed: 5, wins: 2, losses: 2 });

    const ordered = [a, b, c, d].sort(compareStanding).map((s) => s.teamId);
    expect(ordered).toEqual([3, 2, 1, 4]); // c (3W), b (seed1), a (seed3), d (2L)
  });

  it("round 1 : classement égal au seed (aucune partie jouée)", () => {
    const standings = [
      team({ teamId: 10, seed: 2 }),
      team({ teamId: 20, seed: 1 }),
      team({ teamId: 30, seed: 3 }),
    ];
    expect(rankActiveTeams(standings).map((s) => s.teamId)).toEqual([20, 10, 30]);
  });

  it("exclut les équipes éliminées ou forfait", () => {
    const standings = [
      team({ teamId: 1, seed: 1 }),
      team({ teamId: 2, seed: 2, status: "ELIMINATED", eliminatedRound: 3 }),
      team({ teamId: 3, seed: 3, status: "FORFEIT", eliminatedRound: 2 }),
    ];
    expect(rankActiveTeams(standings).map((s) => s.teamId)).toEqual([1]);
  });
});

describe("survival — planSurvivalRound", () => {
  it("apparie les équipes adjacentes (nombre pair, pas de bye)", () => {
    const ordered = [1, 2, 3, 4].map((id) => team({ teamId: id, seed: id }));
    const { pairings, byeTeamId } = planSurvivalRound(ordered);
    expect(byeTeamId).toBeNull();
    expect(pairings).toEqual([
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: 4 },
    ]);
  });

  it("nombre impair : la dernière sans bye reçoit la victoire d'office", () => {
    const ordered = [1, 2, 3, 4, 5].map((id) => team({ teamId: id, seed: id }));
    const { pairings, byeTeamId } = planSurvivalRound(ordered);
    expect(byeTeamId).toBe(5);
    expect(pairings).toEqual([
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: 4 },
    ]);
  });

  it("évite de redonner un bye : choisit la plus basse n'en ayant jamais eu", () => {
    const ordered = [
      team({ teamId: 1, seed: 1 }),
      team({ teamId: 2, seed: 2 }),
      team({ teamId: 3, seed: 3 }),
      team({ teamId: 4, seed: 4 }),
      team({ teamId: 5, seed: 5, hasBye: true }),
    ];
    const { pairings, byeTeamId } = planSurvivalRound(ordered);
    expect(byeTeamId).toBe(4);
    // La 5 (déjà bye) est alors appariée normalement.
    expect(pairings.some((p) => p.teamAId === 5 || p.teamBId === 5)).toBe(true);
  });
});

describe("survival — teamsToEliminate", () => {
  it("retire deux équipes par défaut", () => {
    expect(teamsToEliminate(8)).toBe(2);
    expect(teamsToEliminate(5)).toBe(2);
    expect(teamsToEliminate(3)).toBe(2);
  });

  it("retire une seule équipe quand il n'en resterait sinon aucune", () => {
    expect(teamsToEliminate(2)).toBe(1);
  });

  it("ne retire rien avec au plus une équipe", () => {
    expect(teamsToEliminate(1)).toBe(0);
    expect(teamsToEliminate(0)).toBe(0);
  });
});

describe("survival — isCutRound", () => {
  it("clôt un bloc tous les roundsPerCut rounds", () => {
    expect(isCutRound(3, 3)).toBe(true);
    expect(isCutRound(6, 3)).toBe(true);
    expect(isCutRound(4, 3)).toBe(false);
    expect(isCutRound(1, 1)).toBe(true);
    expect(isCutRound(0, 3)).toBe(false);
  });
});

describe("survival — selectEliminatedTeamIds", () => {
  it("sélectionne les plus basses du classement courant", () => {
    const ordered = [1, 2, 3, 4].map((id) => team({ teamId: id, seed: id }));
    expect(selectEliminatedTeamIds(ordered, 2)).toEqual([3, 4]);
    expect(selectEliminatedTeamIds(ordered, 0)).toEqual([]);
  });
});

describe("survival — computeFinalRanks", () => {
  it("championne au rang 1, puis par round d'élimination décroissant", () => {
    const standings = [
      team({ teamId: 1, seed: 1, wins: 5, status: "ACTIVE" }),
      team({ teamId: 2, seed: 2, wins: 4, status: "ELIMINATED", eliminatedRound: 4 }),
      team({ teamId: 3, seed: 3, wins: 3, status: "ELIMINATED", eliminatedRound: 4 }),
      team({ teamId: 4, seed: 4, wins: 1, status: "FORFEIT", eliminatedRound: 2 }),
    ];
    const ranks = computeFinalRanks(standings);
    expect(ranks.get(1)).toBe(1); // championne
    expect(ranks.get(2)).toBe(2); // éliminée round 4, plus de victoires
    expect(ranks.get(3)).toBe(3); // éliminée round 4
    expect(ranks.get(4)).toBe(4); // sortie au round 2
  });
});

/**
 * Simulateur en mémoire reproduisant la logique de reconcileSurvival à partir
 * des seules fonctions pures : valide la convergence vers une unique championne.
 */
function simulate(
  seeds: number[],
  roundsPerCut: number,
  winnerOf: (a: number, b: number, round: number) => number,
  forfeits: Record<number, number> = {},
): { standings: SurvivalStanding[]; rounds: number } {
  const standings: SurvivalStanding[] = seeds.map((teamId, i) =>
    team({ teamId, seed: i + 1 }),
  );
  const byId = new Map(standings.map((s) => [s.teamId, s]));
  let round = 0;

  while (rankActiveTeams(standings).length > 1) {
    round += 1;

    // Forfaits programmés en début de round.
    for (const [teamIdStr, r] of Object.entries(forfeits)) {
      if (r === round) {
        const s = byId.get(Number(teamIdStr));
        if (s && s.status === "ACTIVE") {
          s.status = "FORFEIT";
          s.eliminatedRound = round;
        }
      }
    }
    if (rankActiveTeams(standings).length <= 1) break;

    const active = rankActiveTeams(standings);
    const { pairings, byeTeamId } = planSurvivalRound(active);

    if (byeTeamId !== null) {
      const s = byId.get(byeTeamId)!;
      s.wins += 1;
      s.hasBye = true;
    }
    for (const p of pairings) {
      const w = winnerOf(p.teamAId, p.teamBId!, round);
      const l = w === p.teamAId ? p.teamBId! : p.teamAId;
      byId.get(w)!.wins += 1;
      byId.get(l)!.losses += 1;
    }

    if (isCutRound(round, roundsPerCut)) {
      const ranked = rankActiveTeams(standings);
      const out = selectEliminatedTeamIds(ranked, teamsToEliminate(ranked.length));
      for (const id of out) {
        const s = byId.get(id)!;
        s.status = "ELIMINATED";
        s.eliminatedRound = round;
      }
    }

    if (round > 1000) throw new Error("boucle infinie");
  }

  return { standings, rounds: round };
}

describe("survival — simulation complète", () => {
  const higherSeedWins = (a: number, b: number) => Math.min(a, b); // teamId le plus petit gagne

  it.each([2, 3, 4, 5, 6, 7, 8, 12, 16])(
    "converge vers exactement une championne (%i équipes, coupe/1)",
    (n) => {
      const seeds = Array.from({ length: n }, (_, i) => i + 1);
      const { standings } = simulate(seeds, 1, higherSeedWins);
      const active = standings.filter((s) => s.status === "ACTIVE");
      expect(active).toHaveLength(1);

      const ranks = computeFinalRanks(standings);
      const values = [...ranks.values()].sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    },
  );

  it.each([1, 2, 3, 4])(
    "converge quelle que soit la cadence de coupe (8 équipes, coupe/%i)",
    (perCut) => {
      const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
      const { standings } = simulate(seeds, perCut, higherSeedWins);
      expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    },
  );

  it("n'élimine jamais la dernière équipe (pas de tournoi sans vainqueur)", () => {
    const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
    const { standings } = simulate(seeds, 2, (a, b, round) =>
      // Alterne les vainqueurs pour brasser le classement.
      round % 2 === 0 ? Math.max(a, b) : Math.min(a, b),
    );
    expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
  });

  it("gère les forfaits et converge toujours", () => {
    const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
    const { standings } = simulate(seeds, 2, higherSeedWins, { 3: 1, 5: 2 });
    expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    // Les équipes forfait ne sont pas championnes.
    const ranks = computeFinalRanks(standings);
    expect(ranks.get(3)).not.toBe(1);
    expect(ranks.get(5)).not.toBe(1);
  });

  it("la championne a le meilleur bilan dans un scénario déterministe", () => {
    // teamId 1 gagne toujours → doit finir championne.
    const seeds = Array.from({ length: 6 }, (_, i) => i + 1);
    const { standings } = simulate(seeds, 2, (a, b) => Math.min(a, b));
    const ranks = computeFinalRanks(standings);
    expect(ranks.get(1)).toBe(1);
  });
});
