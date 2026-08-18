import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/notifications");

import { loadSeedingBoard, reorderSeeding } from "@/lib/server/tournaments/seeding";
import {
  deleteAllMatches,
  getMatchRows,
  loadTournamentRow,
  resetRegistrationRanks,
} from "@/lib/server/tournaments/repository";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";

type Row = Record<string, unknown>;

const connection = {
  execute: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
  release: jest.fn(),
};

async function mockDb() {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({
    getConnection: jest.fn(async () => connection),
  });
}

function tournament(overrides: Row = {}): Row {
  return { id: 5, state: "REGISTRATION", format: "SINGLE", manual_seeding: 0, ...overrides };
}

/** Deux inscriptions : Alpha (seed 1) puis Beta (seed 2). */
function registrationRows() {
  return [
    [
      { team_id: 1, team_name: "Alpha", seed: 1, registered_at: new Date() },
      { team_id: 2, team_name: "Beta", seed: 2, registered_at: new Date() },
    ],
  ];
}

function matchRow(overrides: Row = {}): Row {
  return {
    id: 100,
    round_number: 1,
    team1_id: 1,
    team2_id: 2,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    forfeit_team_id: null,
    status: "READY",
    next_winner_match_id: null,
    next_loser_match_id: null,
    ...overrides,
  };
}

describe("loadSeedingBoard", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await mockDb();
  });
  afterEach(() => jest.restoreAllMocks());

  it("renumérote un ordre à trous et signale l'ordre encore libre", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament() as never);
    connection.execute.mockResolvedValue([
      [
        { team_id: 7, team_name: "Gamma", seed: null, registered_at: new Date() },
        { team_id: 8, team_name: "Delta", seed: 42, registered_at: new Date() },
      ],
    ] as never);
    (getMatchRows as jest.Mock).mockResolvedValue([] as never);

    const board = await loadSeedingBoard(5);

    expect(board?.entries.map((e) => e.seed)).toEqual([1, 2]);
    expect(board?.lockReason).toBeNull();
    expect(board?.manualSeeding).toBe(false);
    expect(connection.release).toHaveBeenCalled();
  });

  it("signale le verrouillage dès qu'un score est saisi", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament({ state: "RUNNING" }) as never);
    connection.execute.mockResolvedValue(registrationRows() as never);
    (getMatchRows as jest.Mock).mockResolvedValue([matchRow({ winner_team_id: 1 })] as never);

    expect((await loadSeedingBoard(5))?.lockReason).toBe("SCORES_ENTERED");
  });

  it("renvoie null pour un tournoi inconnu", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(null as never);
    expect(await loadSeedingBoard(5)).toBeNull();
  });
});

describe("reorderSeeding", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await mockDb();
    connection.execute.mockResolvedValue(registrationRows() as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("écrit les seeds dans le nouvel ordre et marque le seeding manuel", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament() as never);
    (getMatchRows as jest.Mock).mockResolvedValue([] as never);

    await reorderSeeding(5, [2, 1]);

    const updates = connection.execute.mock.calls.filter(([sql]) =>
      String(sql).includes("SET seed = ?"),
    );
    expect(updates.map(([, params]) => params)).toEqual([
      [1, 5, 2],
      [2, 5, 1],
    ]);
    expect(
      connection.execute.mock.calls.some(([sql]) => String(sql).includes("manual_seeding = 1")),
    ).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(5);
    // Aucun match généré : rien à reconstruire.
    expect(deleteAllMatches).not.toHaveBeenCalled();
  });

  it("détruit le plateau existant pour qu'il soit régénéré", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(
      tournament({ state: "RUNNING" }) as never,
    );
    (getMatchRows as jest.Mock).mockResolvedValue([matchRow()] as never);

    await reorderSeeding(5, [2, 1]);

    expect(deleteAllMatches).toHaveBeenCalledWith(connection, 5);
    expect(resetRegistrationRanks).toHaveBeenCalledWith(connection, 5);
    expect(
      connection.execute.mock.calls.some(([sql]) => String(sql).includes("bracket_size = NULL")),
    ).toBe(true);
  });

  it("refuse dès qu'un score est saisi", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament({ state: "RUNNING" }) as never);
    (getMatchRows as jest.Mock).mockResolvedValue([matchRow({ team1_score: 0 })] as never);

    await expect(reorderSeeding(5, [2, 1])).rejects.toThrow("SEEDING_LOCKED");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("refuse un ordre qui n'est pas une permutation des inscrites", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(tournament() as never);
    (getMatchRows as jest.Mock).mockResolvedValue([] as never);

    await expect(reorderSeeding(5, [2, 99])).rejects.toThrow("INVALID_SEED_ORDER");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse un tournoi inconnu", async () => {
    (loadTournamentRow as jest.Mock).mockResolvedValue(null as never);

    await expect(reorderSeeding(5, [1, 2])).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(connection.release).toHaveBeenCalled();
  });
});
