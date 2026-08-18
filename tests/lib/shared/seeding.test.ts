import { describe, expect, it } from "@jest/globals";
import {
  applySeedOrder,
  canReorderSeeding,
  isValidSeedOrder,
  moveInOrder,
  seedingLockReason,
} from "@/lib/shared/seeding";
import type { MatchScoreState } from "@/lib/shared/match-lock";

function match(overrides: Partial<MatchScoreState> = {}): MatchScoreState {
  return {
    id: 1,
    roundNumber: 1,
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    ...overrides,
  };
}

describe("seedingLockReason", () => {
  it("laisse modifiable un tournoi sans aucun match", () => {
    expect(seedingLockReason("REGISTRATION", [])).toBeNull();
    expect(canReorderSeeding("UPCOMING", [])).toBe(true);
  });

  it("laisse modifiable un tournoi démarré tant qu'aucun score n'est saisi", () => {
    expect(seedingLockReason("RUNNING", [match(), match({ id: 2 })])).toBeNull();
  });

  it.each([
    ["un score à 0", { team1Score: 0 }],
    ["un score", { team1Score: 2, team2Score: 1 }],
    ["un vainqueur", { winnerTeamId: 10 }],
    ["un forfait", { forfeitTeamId: 20 }],
    ["un report en attente", { hasPendingReport: true }],
  ])("fige dès %s", (_label, overrides) => {
    expect(seedingLockReason("RUNNING", [match(overrides)])).toBe("SCORES_ENTERED");
  });

  it("ignore les byes et matchs fantômes, dont le score est posé par le moteur", () => {
    const bye = match({ team2Id: null, team1Score: 1, team2Score: 0, winnerTeamId: 10 });
    const ghost = match({ id: 2, team1Id: null, team2Id: null, team1Score: 0, team2Score: 0 });
    expect(seedingLockReason("RUNNING", [bye, ghost])).toBeNull();
  });

  it("fige un tournoi terminé, même sans match", () => {
    expect(seedingLockReason("FINISHED", [])).toBe("FINISHED");
    expect(canReorderSeeding("FINISHED", [])).toBe(false);
  });
});

describe("moveInOrder", () => {
  const order = [1, 2, 3, 4];

  it("monte une équipe d'un cran", () => {
    expect(moveInOrder(order, 3, "up")).toEqual([1, 3, 2, 4]);
  });

  it("descend une équipe d'un cran", () => {
    expect(moveInOrder(order, 2, "down")).toEqual([1, 3, 2, 4]);
  });

  it("ne fait rien aux extrémités", () => {
    expect(moveInOrder(order, 1, "up")).toEqual(order);
    expect(moveInOrder(order, 4, "down")).toEqual(order);
  });

  it("ne fait rien pour une équipe absente", () => {
    expect(moveInOrder(order, 99, "up")).toEqual(order);
  });

  it("ne mute pas le tableau d'origine", () => {
    const source = [1, 2, 3];
    moveInOrder(source, 2, "up");
    expect(source).toEqual([1, 2, 3]);
  });
});

describe("isValidSeedOrder", () => {
  const registered = [7, 8, 9];

  it("accepte une permutation exacte", () => {
    expect(isValidSeedOrder(registered, [9, 7, 8])).toBe(true);
  });

  it.each([
    ["une équipe manquante", [7, 8]],
    ["une équipe en trop", [7, 8, 9, 10]],
    ["un doublon", [7, 8, 8]],
    ["une intruse", [7, 8, 42]],
    ["une liste vide", []],
  ])("refuse %s", (_label, proposed) => {
    expect(isValidSeedOrder(registered, proposed)).toBe(false);
  });
});

describe("applySeedOrder", () => {
  it("renumérote les seeds de 1 à N dans l'ordre fourni", () => {
    const entries = [
      { teamId: 1, teamName: "Alpha", seed: 1 },
      { teamId: 2, teamName: "Beta", seed: 2 },
      { teamId: 3, teamName: "Gamma", seed: 3 },
    ];

    expect(applySeedOrder(entries, [3, 1, 2])).toEqual([
      { teamId: 3, teamName: "Gamma", seed: 1 },
      { teamId: 1, teamName: "Alpha", seed: 2 },
      { teamId: 2, teamName: "Beta", seed: 3 },
    ]);
  });

  it("ignore un identifiant inconnu au lieu de produire un trou", () => {
    const entries = [{ teamId: 1, teamName: "Alpha", seed: 1 }];
    expect(applySeedOrder(entries, [99, 1])).toEqual([{ teamId: 1, teamName: "Alpha", seed: 1 }]);
  });
});
