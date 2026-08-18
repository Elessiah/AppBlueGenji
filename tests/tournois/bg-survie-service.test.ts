import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");

import {
  forfeitEnduranceTeam,
  generateEnduranceRound,
  initializeEnduranceTournament,
  reconcileEndurance,
  startEndurancePlayoffs,
} from "@/lib/server/tournaments/bg-survie";
import { createMatch, finishTournament } from "@/lib/server/tournaments/repository";

type Row = Record<string, unknown>;

function tournamentRow(overrides: Row = {}): Row {
  return {
    format: "BG_SURVIE",
    state: "RUNNING",
    endurance_start_points: 9,
    endurance_win_delta: 1,
    endurance_loss_delta: 1,
    endurance_playoff_size: 8,
    endurance_current_round: 0,
    endurance_playoffs_started: 0,
    has_third_place_match: 0,
    ...overrides,
  };
}

function standingRow(teamId: number, overrides: Row = {}): Row {
  return {
    team_id: teamId,
    seed: teamId,
    points: 9,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminated_round: null,
    rank: teamId,
    ...overrides,
  };
}

/** Connexion mockée dont chaque `execute` renvoie la valeur programmée. */
function makeConn(results: unknown[]) {
  const execute = jest.fn();
  for (const result of results) execute.mockResolvedValueOnce(result as never);
  execute.mockResolvedValue([[]] as never);
  return { execute } as never as Parameters<typeof generateEnduranceRound>[1] & {
    execute: jest.Mock;
  };
}

describe("initializeEnduranceTournament", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("sème le classement dans l'ordre du seeding et fige le barème", async () => {
    const conn = makeConn([
      [[tournamentRow({ endurance_start_points: null })]], // tournoi
      [[{ team_id: 30 }, { team_id: 10 }, { team_id: 20 }]], // inscriptions triées par seed
    ]);

    await initializeEnduranceTournament(5, conn);

    const seedQuery = conn.execute.mock.calls[1][0] as string;
    expect(seedQuery).toMatch(/ORDER BY COALESCE\(seed, 1000000\)/);

    const inserts = conn.execute.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO bg_endurance_standings"),
    );
    // Seed 1, 2, 3 attribués dans l'ordre des inscriptions.
    expect(inserts.map(([, params]) => [(params as unknown[])[1], (params as unknown[])[2]])).toEqual([
      [30, 1],
      [10, 2],
      [20, 3],
    ]);

    const settings = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("endurance_start_points = ?"),
    );
    // Barème par défaut rendu explicite : 9 / +1 / −1 / 8.
    expect((settings?.[1] as unknown[]).slice(0, 4)).toEqual([9, 1, 1, 8]);
  });

  it("ignore un tournoi d'un autre format", async () => {
    const conn = makeConn([[[tournamentRow({ format: "SWISS" })]]]);

    await initializeEnduranceTournament(5, conn);

    expect(conn.execute).toHaveBeenCalledTimes(1);
  });
});

describe("generateEnduranceRound", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("crée un match par couple et laisse l'équipe impaire au repos", async () => {
    (createMatch as jest.Mock).mockResolvedValue(77 as never);
    const conn = makeConn([
      [[tournamentRow({ endurance_playoff_size: 2 })]],
      [[standingRow(1), standingRow(2), standingRow(3)]],
    ]);

    await generateEnduranceRound(5, conn);

    // Trois équipes → un seul match (1 vs 2), la 3ᵉ ne joue pas.
    expect(createMatch).toHaveBeenCalledTimes(1);
    const participants = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("SET team1_id = ?, team2_id = ?, status = 'READY'"),
    );
    expect((participants?.[1] as unknown[]).slice(0, 2)).toEqual([1, 2]);
  });

  it("ne génère rien quand l'effectif est déjà retombé à la cible", async () => {
    const conn = makeConn([
      [[tournamentRow({ endurance_playoff_size: 8 })]],
      [[standingRow(1), standingRow(2)]],
    ]);

    await generateEnduranceRound(5, conn);

    expect(createMatch).not.toHaveBeenCalled();
  });

  it("ne génère rien une fois les play-offs lancés", async () => {
    const conn = makeConn([[[tournamentRow({ endurance_playoffs_started: 1 })]]]);

    await generateEnduranceRound(5, conn);

    expect(createMatch).not.toHaveBeenCalled();
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });
});

describe("startEndurancePlayoffs", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("applique le tableau imposé 8v4, 6v2, 1v5, 3v7", async () => {
    (createMatch as jest.Mock).mockResolvedValue(77 as never);
    // Huit équipes classées 1..8 (points décroissants).
    const standings = Array.from({ length: 8 }, (_, index) =>
      standingRow(index + 1, { points: 20 - index, rank: index + 1 }),
    );
    const conn = makeConn([[[tournamentRow()]], [standings]]);

    await startEndurancePlayoffs(5, conn);

    const pairs = conn.execute.mock.calls
      .filter(([sql]) => String(sql).includes("SET team1_id = ?, team2_id = ?, status = ?"))
      .map(([, params]) => (params as unknown[]).slice(0, 2));

    expect(pairs).toEqual([
      [8, 4],
      [6, 2],
      [1, 5],
      [3, 7],
    ]);
    expect(
      conn.execute.mock.calls.some(([sql]) =>
        String(sql).includes("endurance_playoffs_started = 1"),
      ),
    ).toBe(true);
  });

  it("clôt le tournoi s'il ne reste qu'une équipe", async () => {
    const conn = makeConn([[[tournamentRow()]], [[standingRow(1)]]]);

    await startEndurancePlayoffs(5, conn);

    expect(finishTournament).toHaveBeenCalledWith(conn, 5);
    expect(createMatch).not.toHaveBeenCalled();
  });
});

describe("reconcileEndurance", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("ne touche à rien sur un tournoi terminé", async () => {
    const conn = makeConn([[[tournamentRow({ state: "FINISHED" })]]]);

    await reconcileEndurance(5, conn);

    expect(conn.execute).toHaveBeenCalledTimes(1);
  });

  it("persiste le classement rejoué depuis l'historique", async () => {
    const conn = makeConn([
      [[tournamentRow({ endurance_current_round: 1, endurance_playoff_size: 2 })]],
      [[standingRow(1), standingRow(2), standingRow(3), standingRow(4)]], // classement stocké
      [[{ round_number: 1, status: "COMPLETED", winner_team_id: 1, loser_team_id: 2 }]], // matchs
      [[]], // forfaits
    ]);

    await reconcileEndurance(5, conn);

    const inserts = conn.execute.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO bg_endurance_standings"),
    );
    const byTeam = new Map(
      inserts.map(([, params]) => {
        const values = params as unknown[];
        return [values[1], { points: values[3], wins: values[4], losses: values[5] }];
      }),
    );

    expect(byTeam.get(1)).toEqual({ points: 10, wins: 1, losses: 0 });
    expect(byTeam.get(2)).toEqual({ points: 8, wins: 0, losses: 1 });
    // Les équipes sans match gardent leur capital.
    expect(byTeam.get(3)).toEqual({ points: 9, wins: 0, losses: 0 });
  });
});

describe("forfeitEnduranceTeam", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("marque l'équipe forfait et remet son capital à zéro", async () => {
    const conn = makeConn([
      [[tournamentRow({ endurance_current_round: 3 })]],
      [[{ status: "ACTIVE" }]],
    ]);

    await forfeitEnduranceTeam(5, 42, conn);

    const update = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'FORFEIT'"),
    );
    expect(update?.[1]).toEqual([3, 5, 42]);
  });

  it("refuse une équipe déjà sortie", async () => {
    const conn = makeConn([[[tournamentRow()]], [[{ status: "ELIMINATED" }]]]);

    await expect(forfeitEnduranceTeam(5, 42, conn)).rejects.toThrow("TEAM_ALREADY_OUT");
  });

  it("refuse une équipe non inscrite", async () => {
    const conn = makeConn([[[tournamentRow()]], [[]]]);

    await expect(forfeitEnduranceTeam(5, 42, conn)).rejects.toThrow("TEAM_NOT_IN_TOURNAMENT");
  });

  it("refuse un tournoi d'un autre format", async () => {
    const conn = makeConn([[[tournamentRow({ format: "SURVIVAL" })]]]);

    await expect(forfeitEnduranceTeam(5, 42, conn)).rejects.toThrow("NOT_BG_SURVIE");
  });
});
