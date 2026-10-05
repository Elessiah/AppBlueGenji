import { describe, expect, it } from "@jest/globals";
import {
  applySeedOrder,
  canReorderSeeding,
  isPreLaunchState,
  isSeedOrderEffective,
  isValidSeedOrder,
  moveInOrder,
  orderByFrozenSeeds,
  registrationsFollowFrozenDraw,
  registrationsFollowRanking,
  seedingLockReason,
  seedingWindowState,
  SEEDING_SOURCE_LABELS,
  seedingSource,
} from "@/lib/shared/seeding";
import type { TournamentFormat, TournamentState } from "@/lib/shared/types";
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
    // Même lecture que la fabrique de `match-lock.test.ts` : un match qui
    // porte un vainqueur est tranché — la production ne rend jamais l'un sans
    // l'autre (`decided` vient du statut COMPLETED).
    decided: overrides.winnerTeamId !== undefined && overrides.winnerTeamId !== null,
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

  it("laisse modifiable un plateau vierge avant le coup d'envoi", () => {
    expect(seedingLockReason("REGISTRATION", [match(), match({ id: 2 })])).toBeNull();
  });

  it("fige un tournoi lancé, même sans score ni match", () => {
    expect(seedingLockReason("RUNNING", [match(), match({ id: 2 })])).toBe("STARTED");
    expect(seedingLockReason("RUNNING", [])).toBe("STARTED");
    expect(canReorderSeeding("RUNNING", [])).toBe(false);
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
    expect(seedingLockReason("REGISTRATION", [bye, ghost])).toBeNull();
  });

  it("fige un tournoi terminé, même sans match", () => {
    expect(seedingLockReason("FINISHED", [])).toBe("FINISHED");
    expect(canReorderSeeding("FINISHED", [])).toBe(false);
  });
});

describe("seedingWindowState", () => {
  const START = Date.parse("2026-10-05T18:00:00.000Z");
  const card = (state: TournamentState, finishedAt: string | null = null) => ({
    state,
    finishedAt,
    registrationOpenAt: "2026-10-01T18:00:00.000Z",
    registrationCloseAt: "2026-10-05T17:30:00.000Z",
    startAt: "2026-10-05T18:00:00.000Z",
  });

  it("garde la fenêtre ouverte avant l'heure de début", () => {
    expect(seedingWindowState(card("REGISTRATION"), START - 3_600_000 * 24)).toBe("REGISTRATION");
    // Inscriptions closes, coup d'envoi pas encore donné : toujours réglable.
    expect(seedingWindowState(card("REGISTRATION"), START - 1)).toBe("UPCOMING");
    expect(seedingLockReason(seedingWindowState(card("REGISTRATION"), START - 1), [])).toBeNull();
  });

  it("ferme la fenêtre à l'heure de début, même si l'état stocké n'a pas basculé", () => {
    expect(seedingWindowState(card("REGISTRATION"), START)).toBe("RUNNING");
    expect(seedingLockReason(seedingWindowState(card("REGISTRATION"), START), [])).toBe("STARTED");
  });

  it("suit un lancement anticipé, avant l'heure prévue", () => {
    expect(seedingWindowState(card("RUNNING"), START - 3_600_000)).toBe("RUNNING");
  });

  it("tient pour terminé un tournoi clos, par l'état ou par la date de clôture", () => {
    expect(seedingWindowState(card("FINISHED"), START - 1)).toBe("FINISHED");
    expect(seedingWindowState(card("RUNNING", "2026-10-05T20:00:00.000Z"), START)).toBe("FINISHED");
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

describe("seedingSource", () => {
  it.each<[TournamentFormat]>([["SINGLE"], ["DOUBLE"]])(
    "%s lit la colonne seed, donc l'ordre d'inscription tant que personne n'a réordonné",
    (format) => {
      expect(seedingSource(format, false)).toBe("REGISTRATION");
    },
  );

  it.each<[TournamentFormat]>([["SWISS"], ["SURVIVAL"], ["BG_SURVIE"], ["MULTI"]])(
    "%s seede depuis le classement du site",
    (format) => {
      expect(seedingSource(format, false)).toBe("RANKING");
    },
  );

  it("un ordre fixé à la main l'emporte sur le format, quel qu'il soit", () => {
    const formats: TournamentFormat[] = ["SINGLE", "DOUBLE", "SWISS", "SURVIVAL", "MULTI", "BG_SURVIE"];
    for (const format of formats) {
      expect(seedingSource(format, true)).toBe("MANUAL");
    }
  });

  it("a un libellé pour chaque provenance", () => {
    expect(Object.keys(SEEDING_SOURCE_LABELS).sort()).toEqual(["MANUAL", "RANKING", "REGISTRATION"]);
  });
});

describe("isSeedOrderEffective", () => {
  it("la liste triée par seed est bien le tirage en MANUAL et en REGISTRATION", () => {
    expect(isSeedOrderEffective("MANUAL")).toBe(true);
    expect(isSeedOrderEffective("REGISTRATION")).toBe(true);
  });

  it("ne l'est pas en RANKING : le classement du site prendra la main au lancement", () => {
    expect(isSeedOrderEffective("RANKING")).toBe(false);
  });
});

describe("isPreLaunchState", () => {
  it.each<[TournamentState, boolean]>([
    ["UPCOMING", true],
    ["REGISTRATION", true],
    ["RUNNING", false],
    ["FINISHED", false],
  ])("%s → %s", (state, expected) => {
    expect(isPreLaunchState(state)).toBe(expected);
  });
});

describe("registrationsFollowRanking", () => {
  it("suit le classement du site tant que le tournoi n'est pas lancé, clôture comprise", () => {
    expect(registrationsFollowRanking("RANKING", "REGISTRATION")).toBe(true);
    expect(registrationsFollowRanking("RANKING", "UPCOMING")).toBe(true);
  });

  it("ne le suit plus une fois le tirage fait", () => {
    expect(registrationsFollowRanking("RANKING", "RUNNING")).toBe(false);
    expect(registrationsFollowRanking("RANKING", "FINISHED")).toBe(false);
  });

  it("ne le suit jamais quand l'ordre vient du staff ou des inscriptions", () => {
    expect(registrationsFollowRanking("MANUAL", "REGISTRATION")).toBe(false);
    expect(registrationsFollowRanking("REGISTRATION", "REGISTRATION")).toBe(false);
  });
});

describe("registrationsFollowFrozenDraw", () => {
  it("suit le tirage figé d'un tournoi seedé par le classement, une fois lancé", () => {
    expect(registrationsFollowFrozenDraw("RANKING", "RUNNING")).toBe(true);
    expect(registrationsFollowFrozenDraw("RANKING", "FINISHED")).toBe(true);
  });

  it("ne le suit ni avant le lancement ni hors classement", () => {
    expect(registrationsFollowFrozenDraw("RANKING", "REGISTRATION")).toBe(false);
    expect(registrationsFollowFrozenDraw("MANUAL", "RUNNING")).toBe(false);
    expect(registrationsFollowFrozenDraw("REGISTRATION", "RUNNING")).toBe(false);
  });
});

describe("orderByFrozenSeeds", () => {
  const rows = [
    { teamId: 1, name: "A", seed: 1 },
    { teamId: 2, name: "B", seed: 2 },
    { teamId: 3, name: "C", seed: 3 },
  ];

  it("range par rang figé et porte ce rang, trous compris", () => {
    expect(orderByFrozenSeeds(rows, new Map([[3, 1], [1, 4], [2, 2]]))).toEqual([
      { teamId: 3, name: "C", seed: 1 },
      { teamId: 2, name: "B", seed: 2 },
      { teamId: 1, name: "A", seed: 4 },
    ]);
  });

  it("met les engagées sans rang en dernier, seed nul, dans leur ordre d'origine", () => {
    expect(orderByFrozenSeeds(rows, new Map([[2, 1]])).map((r) => [r.teamId, r.seed])).toEqual([
      [2, 1],
      [1, null],
      [3, null],
    ]);
  });

  it("ne modifie pas les lignes reçues", () => {
    orderByFrozenSeeds(rows, new Map([[3, 1]]));
    expect(rows[2].seed).toBe(3);
  });
});
