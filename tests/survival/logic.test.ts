import { describe, it, expect } from "@jest/globals";
import {
  compareStanding,
  computeFinalRanks,
  isCutRound,
  needsBarrage,
  planSurvivalRound,
  rankActiveTeams,
  selectEliminatedTeamIds,
  shouldEliminateBarrageLoser,
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
    const { pairings, byeTeamId, isBarrage } = planSurvivalRound(ordered);
    expect(byeTeamId).toBeNull();
    expect(isBarrage).toBe(false);
    expect(pairings).toEqual([
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: 4 },
    ]);
  });

  it("nombre pair : aucun barrage même si autorisé", () => {
    const ordered = [1, 2, 3, 4].map((id) => team({ teamId: id, seed: id }));
    const plan = planSurvivalRound(ordered, { allowBarrage: true });
    expect(plan.isBarrage).toBe(false);
    expect(plan.pairings).toHaveLength(2);
  });

  it("barrage : nombre impair au round 1 → un seul match entre les deux dernières", () => {
    const ordered = [1, 2, 3, 4, 5].map((id) => team({ teamId: id, seed: id }));
    const { pairings, byeTeamId, isBarrage } = planSurvivalRound(ordered, {
      allowBarrage: true,
    });
    expect(isBarrage).toBe(true);
    expect(byeTeamId).toBeNull(); // aucune victoire d'office
    expect(pairings).toEqual([{ teamAId: 4, teamBId: 5 }]);
  });

  it("barrage : trois équipes → 2 vs 3, la tête de classement attend", () => {
    const ordered = [1, 2, 3].map((id) => team({ teamId: id, seed: id }));
    const { pairings, isBarrage } = planSurvivalRound(ordered, { allowBarrage: true });
    expect(isBarrage).toBe(true);
    expect(pairings).toEqual([{ teamAId: 2, teamBId: 3 }]);
  });

  it("barrage : le classement courant prime sur le seed", () => {
    const ordered = rankActiveTeams([
      team({ teamId: 1, seed: 1, wins: 0, losses: 2 }),
      team({ teamId: 2, seed: 2, wins: 2, losses: 0 }),
      team({ teamId: 3, seed: 3, wins: 1, losses: 1 }),
    ]);
    const { pairings } = planSurvivalRound(ordered, { allowBarrage: true });
    // Classement : 2 (2W), 3 (1W), 1 (0W) → barrage entre les deux dernières.
    expect(pairings).toEqual([{ teamAId: 3, teamBId: 1 }]);
  });

  it("nombre impair hors round 1 (forfait) : la dernière sans bye a la victoire d'office", () => {
    const ordered = [1, 2, 3, 4, 5].map((id) => team({ teamId: id, seed: id }));
    const { pairings, byeTeamId, isBarrage } = planSurvivalRound(ordered);
    expect(isBarrage).toBe(false);
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
  it("retire deux équipes quand l'effectif est pair", () => {
    expect(teamsToEliminate(8)).toBe(2);
    expect(teamsToEliminate(6)).toBe(2);
    expect(teamsToEliminate(4)).toBe(2);
  });

  it("coupe d'équilibrage : une seule équipe quand l'effectif est impair", () => {
    expect(teamsToEliminate(7)).toBe(1);
    expect(teamsToEliminate(5)).toBe(1);
    expect(teamsToEliminate(3)).toBe(1);
  });

  it("laisse toujours un reliquat pair (plus jamais de victoire d'office)", () => {
    for (let n = 3; n <= 40; n++) {
      const left = n - teamsToEliminate(n);
      expect(left % 2).toBe(0);
    }
  });

  it("retire une seule équipe quand il n'en resterait sinon aucune", () => {
    expect(teamsToEliminate(2)).toBe(1);
  });

  it("ne retire rien avec au plus une équipe", () => {
    expect(teamsToEliminate(1)).toBe(0);
    expect(teamsToEliminate(0)).toBe(0);
  });
});

describe("survival — needsBarrage / shouldEliminateBarrageLoser", () => {
  it("barrage seulement à partir de trois équipes en nombre impair", () => {
    expect(needsBarrage(7)).toBe(true);
    expect(needsBarrage(3)).toBe(true);
    expect(needsBarrage(8)).toBe(false);
    expect(needsBarrage(2)).toBe(false);
    expect(needsBarrage(1)).toBe(false);
  });

  it("le perdant du barrage ne sort que si l'effectif est encore impair", () => {
    expect(shouldEliminateBarrageLoser(7)).toBe(true);
    // Un forfait pendant le barrage a déjà rétabli la parité.
    expect(shouldEliminateBarrageLoser(6)).toBe(false);
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

  it("le round de barrage ne compte pas dans la cadence", () => {
    // Barrage au round 1 : la cadence démarre au round 2.
    expect(isCutRound(1, 1, 1)).toBe(false);
    expect(isCutRound(2, 1, 1)).toBe(true);
    expect(isCutRound(1, 3, 1)).toBe(false);
    expect(isCutRound(4, 3, 1)).toBe(true);
    expect(isCutRound(3, 3, 1)).toBe(false);
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
): {
  standings: SurvivalStanding[];
  rounds: number;
  barrageRounds: number;
  /** Numéros des rounds ayant comporté une victoire d'office. */
  byeRounds: number[];
} {
  const standings: SurvivalStanding[] = seeds.map((teamId, i) =>
    team({ teamId, seed: i + 1 }),
  );
  const byId = new Map(standings.map((s) => [s.teamId, s]));
  let round = 0;
  let barrageRounds = 0;
  const byeRounds: number[] = [];

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
    const { pairings, byeTeamId, isBarrage } = planSurvivalRound(active, {
      allowBarrage: round === 1,
    });
    if (isBarrage) barrageRounds = 1;

    if (byeTeamId !== null) {
      byeRounds.push(round);
      const s = byId.get(byeTeamId)!;
      s.wins += 1;
      s.hasBye = true;
    }

    let lastLoserId: number | null = null;
    for (const p of pairings) {
      const w = winnerOf(p.teamAId, p.teamBId!, round);
      const l = w === p.teamAId ? p.teamBId! : p.teamAId;
      byId.get(w)!.wins += 1;
      byId.get(l)!.losses += 1;
      lastLoserId = l;
    }

    if (isBarrage) {
      // Le perdant du barrage sort, sauf si un forfait a déjà rétabli la parité.
      const ranked = rankActiveTeams(standings);
      const loser = lastLoserId === null ? undefined : byId.get(lastLoserId);
      if (shouldEliminateBarrageLoser(ranked.length) && loser?.status === "ACTIVE") {
        loser.status = "ELIMINATED";
        loser.eliminatedRound = round;
      }
    } else if (isCutRound(round, roundsPerCut, barrageRounds)) {
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

  return { standings, rounds: round, barrageRounds, byeRounds };
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

  it.each([3, 5, 7, 9, 11, 15, 21])(
    "aucune victoire d'office hors forfait (%i équipes, coupe/1)",
    (n) => {
      const seeds = Array.from({ length: n }, (_, i) => i + 1);
      const { byeRounds, barrageRounds, standings } = simulate(seeds, 1, higherSeedWins);
      expect(barrageRounds).toBe(1);
      expect(byeRounds).toEqual([]);
      expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    },
  );

  it.each([1, 2, 3, 5])(
    "aucune victoire d'office quelle que soit la cadence (11 équipes, coupe/%i)",
    (perCut) => {
      const seeds = Array.from({ length: 11 }, (_, i) => i + 1);
      const { byeRounds, standings } = simulate(seeds, perCut, (a, b, round) =>
        round % 2 === 0 ? Math.max(a, b) : Math.min(a, b),
      );
      expect(byeRounds).toEqual([]);
      expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    },
  );

  it("nombre pair : aucun barrage, aucune victoire d'office", () => {
    const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
    const { barrageRounds, byeRounds } = simulate(seeds, 1, higherSeedWins);
    expect(barrageRounds).toBe(0);
    expect(byeRounds).toEqual([]);
  });

  it("barrage : une seule équipe sort au round 1", () => {
    const seeds = Array.from({ length: 7 }, (_, i) => i + 1);
    const { standings } = simulate(seeds, 2, higherSeedWins);
    const outAtRound1 = standings.filter((s) => s.eliminatedRound === 1);
    expect(outAtRound1).toHaveLength(1);
    // Le perdant du barrage est l'une des deux dernières du seeding.
    expect([6, 7]).toContain(outAtRound1[0].teamId);
  });

  it("barrage : l'effectif redevient pair dès le round 1", () => {
    const standings = Array.from({ length: 9 }, (_, i) =>
      team({ teamId: i + 1, seed: i + 1 }),
    );
    const plan = planSurvivalRound(rankActiveTeams(standings), { allowBarrage: true });
    expect(plan.pairings).toHaveLength(1);

    const loser = standings.find((s) => s.teamId === plan.pairings[0].teamBId)!;
    loser.status = "ELIMINATED";
    loser.eliminatedRound = 1;

    const active = rankActiveTeams(standings);
    expect(active).toHaveLength(8);
    expect(planSurvivalRound(active).byeTeamId).toBeNull();
  });

  it("forfait rendant l'effectif impair : la coupe suivante n'élimine qu'une équipe", () => {
    // 8 équipes paires, forfait au round 2 → 7 actives (impair).
    const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
    const { standings, byeRounds } = simulate(seeds, 2, higherSeedWins, { 8: 2 });
    // La coupe d'équilibrage ramène au pair : les byes cessent après elle.
    const cutRound = Math.min(
      ...standings
        .filter((s) => s.status === "ELIMINATED" && s.eliminatedRound !== null)
        .map((s) => s.eliminatedRound as number),
    );
    expect(byeRounds.every((r) => r <= cutRound)).toBe(true);
    expect(standings.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
  });

  it("la championne a le meilleur bilan dans un scénario déterministe", () => {
    // teamId 1 gagne toujours → doit finir championne.
    const seeds = Array.from({ length: 6 }, (_, i) => i + 1);
    const { standings } = simulate(seeds, 2, (a, b) => Math.min(a, b));
    const ranks = computeFinalRanks(standings);
    expect(ranks.get(1)).toBe(1);
  });
});
