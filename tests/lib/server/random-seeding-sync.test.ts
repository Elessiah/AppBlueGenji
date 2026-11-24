import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Tirage au sort dans l'entretien (`docs/features/RANDOM_SEEDING.md`) : à la
 * clôture, et au plus tard **avant** que le coup d'envoi ne sème le format.
 */

jest.mock("@/lib/server/tournaments/repository", () => ({
  loadTournamentRow: jest.fn(),
  updateTournamentState: jest.fn(async () => undefined),
}));
jest.mock("@/lib/server/tournaments/random-seeding", () => ({ drawRandomSeedingIfDue: jest.fn() }));
jest.mock("@/lib/server/tournaments/bot-logs", () => ({ queueBotLog: jest.fn() }));
jest.mock("@/lib/server/tournaments/finalization", () => ({
  finalizeUnderfilledTournament: jest.fn(async () => false),
  resolveExpiredScoreReports: jest.fn(async () => 0),
  finalizeTournamentIfDone: jest.fn(async () => undefined),
}));
jest.mock("@/lib/server/tournaments/byes", () => ({ tryAutoResolveByes: jest.fn(async () => undefined) }));
jest.mock("@/lib/server/tournaments/match-launch", () => ({ maintainMatchLaunches: jest.fn(async () => 0) }));
jest.mock("@/lib/server/tournaments/swiss", () => ({
  initializeSwissTournament: jest.fn(async () => undefined),
  generateSwissRound: jest.fn(async () => undefined),
  reconcileSwiss: jest.fn(async () => undefined),
}));

import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { drawRandomSeedingIfDue } from "@/lib/server/tournaments/random-seeding";
import { initializeSwissTournament } from "@/lib/server/tournaments/swiss";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";
import { tournamentRow } from "../../helpers/tournament-rows";

const HOUR = 3_600_000;

/** Inscriptions closes depuis une heure, départ dans une heure : état stocké à jour. */
function closedRow(overrides: Parameters<typeof tournamentRow>[0] = {}) {
  return tournamentRow({
    state: "UPCOMING",
    registration_open_at: new Date(Date.now() - 48 * HOUR),
    registration_close_at: new Date(Date.now() - HOUR),
    start_at: new Date(Date.now() + HOUR),
    random_seeding: 1,
    random_seeding_drawn_at: null,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("syncTournamentState — tirage au sort", () => {
  it("tire à la clôture, relit la ligne et signale un contenu changé", async () => {
    const before = closedRow();
    const after = closedRow({ manual_seeding: 1, random_seeding_drawn_at: new Date() });
    jest.mocked(loadTournamentRow).mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    jest.mocked(drawRandomSeedingIfDue).mockResolvedValue(true);
    const connection = fakeConnection(connectionMock());

    const result = await syncTournamentState(connection, 1);

    expect(drawRandomSeedingIfDue).toHaveBeenCalledWith(connection, 1);
    expect(loadTournamentRow).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ row: after, stateChanged: false, contentChanged: true, randomDrawn: true });
  });

  it("ne relit rien et ne signale rien quand une passe concurrente a déjà tiré", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValueOnce(closedRow());
    jest.mocked(drawRandomSeedingIfDue).mockResolvedValue(false);

    const result = await syncTournamentState(fakeConnection(connectionMock()), 1);

    expect(loadTournamentRow).toHaveBeenCalledTimes(1);
    expect(result.contentChanged).toBe(false);
    expect(result.randomDrawn).toBeUndefined();
  });

  it("ne prend pas le verrou du tirage quand rien n'est dû", async () => {
    for (const row of [
      closedRow({ random_seeding: 0 }),
      closedRow({ random_seeding_drawn_at: new Date() }),
      closedRow({ registration_close_at: new Date(Date.now() + HOUR), start_at: new Date(Date.now() + 2 * HOUR) }),
    ]) {
      jest.mocked(loadTournamentRow).mockResolvedValueOnce(row);
      await syncTournamentState(fakeConnection(connectionMock()), 1);
    }
    expect(drawRandomSeedingIfDue).not.toHaveBeenCalled();
  });

  it("au coup d'envoi, tire avant de semer le format et le sème sur la ligne relue", async () => {
    const launching = { start_at: new Date(Date.now() - 60_000), format: "SWISS" as const };
    const before = closedRow(launching);
    const after = closedRow({ ...launching, manual_seeding: 1, random_seeding_drawn_at: new Date() });
    jest.mocked(loadTournamentRow).mockResolvedValueOnce(before).mockResolvedValue(after);
    const order: string[] = [];
    jest.mocked(drawRandomSeedingIfDue).mockImplementation(async () => {
      order.push("draw");
      return true;
    });
    jest.mocked(initializeSwissTournament).mockImplementation(async () => {
      order.push("init");
    });

    const result = await syncTournamentState(fakeConnection(connectionMock()), 1);

    expect(order).toEqual(["draw", "init"]);
    expect(result.stateChanged).toBe(true);
    expect(result.contentChanged).toBe(true);
  });
});
