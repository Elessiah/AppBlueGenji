import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/registration-removal", () => ({ withdrawRegistrationOn: jest.fn() }));
jest.mock("@/lib/server/tournaments/state", () => ({ syncTournamentState: jest.fn() }));
jest.mock("@/lib/server/tournaments/bot-logs", () => ({ flushBotLogs: jest.fn(), discardBotLogs: jest.fn() }));
jest.mock("@/lib/server/users/account-deletion", () => ({
  listSoloRegistrationTournamentIds: jest.fn(),
  loadSoloRegistrations: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { listSoloRegistrationTournamentIds, loadSoloRegistrations } from "@/lib/server/users/account-deletion";
import { resetSettleIdleForTests, settleDeletedSoloEntries } from "@/lib/server/users/deleted-solo-entries";
import { connectionMock, fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * EF-62 (revue standard, cycle 1) : une annonce qui ne part pas après le commit
 * du passage horaire ne fait pas passer ses effets pour un échec.
 */

function fakeDb() {
  const execute = jest.fn<SqlQuery>(async (sql) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT DISTINCT u.id")) return [[{ id: 7 }]];
    return [[]];
  });
  const connection = connectionMock();
  connection.execute.mockImplementation(async (sql) =>
    String(sql).includes("SELECT is_deleted FROM bg_users") ? [[{ is_deleted: 1 }]] : [[]],
  );
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn(async () => connection) }));
  return { execute, connection };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSettleIdleForTests();
  jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([3]);
  jest.mocked(loadSoloRegistrations).mockResolvedValue([]);
  jest.mocked(syncTournamentState).mockResolvedValue({
    row: null,
    stateChanged: true,
    contentChanged: false,
    launchesChanged: false,
  });
});

describe("settleDeletedSoloEntries — annonces après le commit", () => {
  it("settleDeletedSoloEntries_flushThrowsAfterCommit_stillRepublishesStartedTournament", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(flushBotLogs).mockImplementation(() => {
      throw new Error("BOT_DOWN");
    });
    const { connection } = fakeDb();

    await settleDeletedSoloEntries();

    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(3);
    expect(JSON.stringify(log.mock.calls)).not.toContain("reportées");
    log.mockRestore();
  });

  it("settleDeletedSoloEntries_flushThrowsAfterCommit_accountNotSetAside", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(flushBotLogs).mockImplementation(() => {
      throw new Error("BOT_DOWN");
    });
    const { execute } = fakeDb();

    await settleDeletedSoloEntries();
    await settleDeletedSoloEntries();

    const candidateQueries = execute.mock.calls.filter(([q]) => String(q).includes("SELECT DISTINCT u.id"));
    expect(String(candidateQueries[1][0])).not.toContain("NOT IN");
    log.mockRestore();
  });

  // Revue standard cycle 2 : un écouteur qui lève après le commit ne fait pas
  // non plus passer les retraits pour un échec.
  it("settleDeletedSoloEntries_publishThrowsAfterCommit_stillCountsAndRepublishesWithdrawals", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(publishUpdatedEvent).mockImplementationOnce(() => {
      throw new Error("LISTENER_DOWN");
    });
    jest.mocked(loadSoloRegistrations).mockResolvedValue([
      {
        tournamentId: 3,
        teamId: 900,
        hasMatch: false,
        state: "REGISTRATION",
        registrationOpenAt: "2026-01-01T00:00:00.000Z",
        registrationCloseAt: "2098-12-31T00:00:00.000Z",
        startAt: "2099-01-01T00:00:00.000Z",
      },
    ]);
    fakeDb();

    const outcome = await settleDeletedSoloEntries();

    expect(outcome.withdrawn).toBe(1);
    // Le coup d'envoi (qui lève), puis le retrait, rediffusé par le passage.
    expect(publishUpdatedEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("reportées");
    log.mockRestore();
  });
  // Revue standard cycle 3 : la rediffusion d'un retrait déjà commis qui lève
  // n'arrête ni les forfaits ni ne met le compte à l'écart.
  it("settleDeletedSoloEntries_withdrawalRepublishThrows_stillForfeitsAndKeepsAccountInBatch", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(publishUpdatedEvent).mockImplementation(() => {
      throw new Error("LISTENER_DOWN");
    });
    jest.mocked(loadSoloRegistrations).mockResolvedValue([
      {
        tournamentId: 3,
        teamId: 900,
        hasMatch: false,
        state: "REGISTRATION",
        registrationOpenAt: "2026-01-01T00:00:00.000Z",
        registrationCloseAt: "2098-12-31T00:00:00.000Z",
        startAt: "2099-01-01T00:00:00.000Z",
      },
    ]);
    const { execute } = fakeDb();

    const outcome = await settleDeletedSoloEntries();
    const afterFirstPass = execute.mock.calls.length;
    await settleDeletedSoloEntries();

    expect(outcome.withdrawn).toBe(1);
    expect(JSON.stringify(log.mock.calls)).toContain("non rediffusé");
    expect(JSON.stringify(log.mock.calls)).not.toContain("reportées");
    // Journal tenté et forfaits relevés malgré la rediffusion en échec.
    const firstPass = execute.mock.calls.slice(0, afterFirstPass).map(([q]) => String(q));
    expect(firstPass.some((q) => q.includes("FROM bg_tournaments t WHERE t.id = ?"))).toBe(true);
    expect(firstPass.some((q) => q.includes("t.state = 'RUNNING'"))).toBe(true);
    const candidateQueries = execute.mock.calls.filter(([q]) => String(q).includes("SELECT DISTINCT u.id"));
    expect(String(candidateQueries[1][0])).not.toContain("NOT IN");
    log.mockRestore();
  });

  // Revue standard cycle 4 : un journal qui lève n'arrête pas les forfaits.
  it("settleDeletedSoloEntries_withdrawalLogThrows_stillQueriesForfeits", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadSoloRegistrations).mockResolvedValue([
      {
        tournamentId: 3,
        teamId: 900,
        hasMatch: false,
        state: "REGISTRATION",
        registrationOpenAt: "2026-01-01T00:00:00.000Z",
        registrationCloseAt: "2098-12-31T00:00:00.000Z",
        startAt: "2099-01-01T00:00:00.000Z",
      },
    ]);
    const { execute } = fakeDb();
    const candidates = execute.getMockImplementation();
    execute.mockImplementation(async (sql, params) => {
      if (String(sql).includes("FROM bg_tournaments t WHERE t.id = ?")) throw new Error("DB_DOWN");
      return candidates!(sql, params);
    });

    const outcome = await settleDeletedSoloEntries();

    expect(outcome.withdrawn).toBe(1);
    const queries = execute.mock.calls.map(([q]) => String(q));
    expect(queries.some((q) => q.includes("t.state = 'RUNNING'"))).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain("reportées");
    log.mockRestore();
  });
});
