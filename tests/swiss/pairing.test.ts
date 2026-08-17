import { describe, expect, it } from "@jest/globals";
import {
  compareParticipants,
  planFirstRound,
  planNextRound,
  samePlan,
  type Participant,
} from "@/lib/shared/swiss-pairing";

function team(overrides: Partial<Participant> & { teamId: number }): Participant {
  return {
    points: 0,
    opponentIds: [],
    hasReceivedBye: false,
    seed: overrides.teamId,
    ...overrides,
  };
}

/** Toutes les équipes sont-elles appariées exactement une fois (bye compris) ? */
function coverage(plan: ReturnType<typeof planNextRound>): number[] {
  const ids = plan.pairings.flatMap((p) => [p.teamAId, p.teamBId!]);
  if (plan.byeTeamId !== null) ids.push(plan.byeTeamId);
  return ids.sort((a, b) => a - b);
}

/** Y a-t-il un rematch dans le plan ? */
function rematches(plan: ReturnType<typeof planNextRound>, participants: Participant[]): number {
  const byId = new Map(participants.map((p) => [p.teamId, p]));
  return plan.pairings.filter((p) =>
    byId.get(p.teamAId)?.opponentIds.includes(p.teamBId!),
  ).length;
}

describe("swiss-pairing — compareParticipants", () => {
  it("classe par points décroissants, puis seed, puis identifiant", () => {
    const a = team({ teamId: 1, seed: 3, points: 6 });
    const b = team({ teamId: 2, seed: 1, points: 6 });
    const c = team({ teamId: 3, seed: 2, points: 9 });
    const d = team({ teamId: 4, seed: 5, points: 3 });

    expect([a, b, c, d].sort(compareParticipants).map((p) => p.teamId)).toEqual([3, 2, 1, 4]);
  });

  it("place les participants sans seed derrière ceux qui en ont un", () => {
    const withSeed = team({ teamId: 9, seed: 4, points: 0 });
    const without: Participant = {
      teamId: 1,
      points: 0,
      opponentIds: [],
      hasReceivedBye: false,
    };
    expect([without, withSeed].sort(compareParticipants).map((p) => p.teamId)).toEqual([9, 1]);
  });
});

describe("swiss-pairing — planFirstRound", () => {
  it("oppose la moitié haute à la moitié basse du seeding", () => {
    const participants = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => team({ teamId: id, seed: id }));
    const plan = planFirstRound(participants);

    expect(plan.byeTeamId).toBeNull();
    expect(plan.pairings).toEqual([
      { teamAId: 1, teamBId: 5 },
      { teamAId: 2, teamBId: 6 },
      { teamAId: 3, teamBId: 7 },
      { teamAId: 4, teamBId: 8 },
    ]);
  });

  it("respecte le seeding même si la liste arrive en désordre", () => {
    const participants = [4, 1, 3, 2].map((id) => team({ teamId: id * 10, seed: id }));
    const plan = planFirstRound(participants);

    // Seeds 1,2 (ids 10,20) contre seeds 3,4 (ids 30,40).
    expect(plan.pairings).toEqual([
      { teamAId: 10, teamBId: 30 },
      { teamAId: 20, teamBId: 40 },
    ]);
  });

  it("effectif impair : la dernière du seeding reçoit la victoire d'office", () => {
    const participants = [1, 2, 3, 4, 5, 6, 7].map((id) => team({ teamId: id, seed: id }));
    const plan = planFirstRound(participants);

    expect(plan.byeTeamId).toBe(7);
    expect(plan.pairings).toHaveLength(3);
    expect(coverage(plan)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("une seule équipe : elle passe la ronde d'office", () => {
    const plan = planFirstRound([team({ teamId: 42 })]);
    expect(plan).toEqual({ pairings: [], byeTeamId: 42 });
  });

  it("liste vide : plan vide", () => {
    expect(planFirstRound([])).toEqual({ pairings: [], byeTeamId: null });
  });
});

describe("swiss-pairing — planNextRound", () => {
  it("apparie les groupes de score entre eux (gagnantes contre gagnantes)", () => {
    const participants = [
      team({ teamId: 1, seed: 1, points: 3, opponentIds: [5] }),
      team({ teamId: 2, seed: 2, points: 3, opponentIds: [6] }),
      team({ teamId: 3, seed: 3, points: 3, opponentIds: [7] }),
      team({ teamId: 4, seed: 4, points: 3, opponentIds: [8] }),
      team({ teamId: 5, seed: 5, points: 0, opponentIds: [1] }),
      team({ teamId: 6, seed: 6, points: 0, opponentIds: [2] }),
      team({ teamId: 7, seed: 7, points: 0, opponentIds: [3] }),
      team({ teamId: 8, seed: 8, points: 0, opponentIds: [4] }),
    ];

    const plan = planNextRound(participants);

    expect(plan.byeTeamId).toBeNull();
    expect(plan.pairings).toEqual([
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: 4 },
      { teamAId: 5, teamBId: 6 },
      { teamAId: 7, teamBId: 8 },
    ]);
  });

  it("évite les rematchs en piochant dans le groupe voisin", () => {
    // 1 et 2 sont à 3 points et se sont déjà rencontrées : elles doivent
    // descendre chercher un adversaire plutôt que de rejouer.
    const participants = [
      team({ teamId: 1, seed: 1, points: 3, opponentIds: [2] }),
      team({ teamId: 2, seed: 2, points: 3, opponentIds: [1] }),
      team({ teamId: 3, seed: 3, points: 0, opponentIds: [4] }),
      team({ teamId: 4, seed: 4, points: 0, opponentIds: [3] }),
    ];

    const plan = planNextRound(participants);

    expect(rematches(plan, participants)).toBe(0);
    expect(coverage(plan)).toEqual([1, 2, 3, 4]);
  });

  it("retour sur trace : trouve la solution qu'un tirage glouton manquerait", () => {
    // 1 a déjà joué 2 ; 2 a déjà joué 1 et 4. Un tirage glouton apparie 1 avec le
    // premier adversaire libre (3), et laisse 2 face à 4 — un rematch — alors que
    // 1-4 / 2-3 n'en produit aucun. Seul le retour sur trace le voit.
    const participants = [
      team({ teamId: 1, seed: 1, points: 9, opponentIds: [2] }),
      team({ teamId: 2, seed: 2, points: 6, opponentIds: [1, 4] }),
      team({ teamId: 3, seed: 3, points: 3, opponentIds: [] }),
      team({ teamId: 4, seed: 4, points: 0, opponentIds: [2] }),
    ];

    const plan = planNextRound(participants);

    expect(rematches(plan, participants)).toBe(0);
    expect(plan.pairings).toEqual([
      { teamAId: 1, teamBId: 4 },
      { teamAId: 2, teamBId: 3 },
    ]);
  });

  it("accepte un rematch en dernier recours quand tout le monde s'est rencontré", () => {
    const participants = [
      team({ teamId: 1, seed: 1, points: 3, opponentIds: [2] }),
      team({ teamId: 2, seed: 2, points: 3, opponentIds: [1] }),
    ];

    const plan = planNextRound(participants);

    // Mieux vaut rejouer que rendre la ronde impossible.
    expect(plan.pairings).toEqual([{ teamAId: 1, teamBId: 2 }]);
  });

  it("attribue la victoire d'office à la dernière équipe n'en ayant pas reçu", () => {
    const participants = [
      team({ teamId: 1, seed: 1, points: 6, hasReceivedBye: false }),
      team({ teamId: 2, seed: 2, points: 3, hasReceivedBye: false }),
      team({ teamId: 3, seed: 3, points: 3, hasReceivedBye: false }),
      team({ teamId: 4, seed: 4, points: 0, hasReceivedBye: false }),
      team({ teamId: 5, seed: 5, points: 0, hasReceivedBye: true }),
    ];

    const plan = planNextRound(participants);

    // 5 est la dernière du classement mais a déjà eu son bye : il revient à 4.
    expect(plan.byeTeamId).toBe(4);
    expect(coverage(plan)).toEqual([1, 2, 3, 4, 5]);
  });

  it("retombe sur la dernière du classement si toutes ont déjà eu un bye", () => {
    const participants = [
      team({ teamId: 1, seed: 1, points: 3, hasReceivedBye: true }),
      team({ teamId: 2, seed: 2, points: 3, hasReceivedBye: true }),
      team({ teamId: 3, seed: 3, points: 0, hasReceivedBye: true }),
    ];

    expect(planNextRound(participants).byeTeamId).toBe(3);
  });

  it("est déterministe pour une même entrée", () => {
    const participants = [
      team({ teamId: 1, seed: 1, points: 3, opponentIds: [5] }),
      team({ teamId: 2, seed: 2, points: 3, opponentIds: [6] }),
      team({ teamId: 3, seed: 3, points: 0, opponentIds: [7] }),
      team({ teamId: 4, seed: 4, points: 0, opponentIds: [8] }),
      team({ teamId: 5, seed: 5, points: 0, opponentIds: [1] }),
      team({ teamId: 6, seed: 6, points: 0, opponentIds: [2] }),
    ];

    expect(planNextRound(participants)).toEqual(planNextRound(participants));
  });

  it("apparie un gros effectif impair sans doublon ni oubli", () => {
    const participants = Array.from({ length: 31 }, (_, i) =>
      team({ teamId: i + 1, seed: i + 1, points: (i % 4) * 3 }),
    );

    const plan = planNextRound(participants);

    expect(plan.byeTeamId).not.toBeNull();
    expect(plan.pairings).toHaveLength(15);
    expect(coverage(plan)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("liste vide : plan vide", () => {
    expect(planNextRound([])).toEqual({ pairings: [], byeTeamId: null });
  });
});

describe("swiss-pairing — samePlan", () => {
  const plan = {
    pairings: [
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: 4 },
    ],
    byeTeamId: 5,
  };

  it("ignore l'ordre des paires et des équipes au sein d'une paire", () => {
    expect(
      samePlan(plan, {
        pairings: [
          { teamAId: 4, teamBId: 3 },
          { teamAId: 2, teamBId: 1 },
        ],
        byeTeamId: 5,
      }),
    ).toBe(true);
  });

  it("distingue un appariement différent", () => {
    expect(
      samePlan(plan, {
        pairings: [
          { teamAId: 1, teamBId: 3 },
          { teamAId: 2, teamBId: 4 },
        ],
        byeTeamId: 5,
      }),
    ).toBe(false);
  });

  it("distingue un bye différent", () => {
    expect(samePlan(plan, { ...plan, byeTeamId: 6 })).toBe(false);
  });

  it("distingue un nombre de paires différent", () => {
    expect(samePlan(plan, { pairings: plan.pairings.slice(1), byeTeamId: 5 })).toBe(false);
  });
});
