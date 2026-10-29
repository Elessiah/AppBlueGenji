import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/bot-logs");

import { withConnection } from "@/lib/server/database";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { inTransaction, transact } from "@/lib/server/tournaments/transaction";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

/**
 * Transaction commune aux gestes de match et de tournoi
 * (`lib/server/tournaments/transaction.ts`, `docs/features/ROUND_MAPS.md`).
 */

let connection: ReturnType<typeof connectionMock> & { destroy: jest.Mock<() => void> };

beforeEach(() => {
  jest.clearAllMocks();
  connection = { ...connectionMock(), destroy: jest.fn<() => void>() };
  connection.beginTransaction.mockResolvedValue();
  connection.commit.mockResolvedValue();
  connection.rollback.mockResolvedValue();
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection(connection)));
});

describe("transact", () => {
  it("transact_runSucceeds_commitsFlushesLogsAndReturnsResult", async () => {
    const actual = await transact(fakeConnection(connection), async () => 42);

    expect(actual).toBe(42);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(flushBotLogs).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("transact_runThrows_rollsBackDiscardsLogsAndRethrows", async () => {
    await expect(
      transact(fakeConnection(connection), async () => {
        throw new Error("INVALID_ROUND");
      }),
    ).rejects.toThrow("INVALID_ROUND");

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(discardBotLogs).toHaveBeenCalledTimes(1);
    expect(flushBotLogs).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("transact_rollbackFails_destroysConnectionAndRethrowsOriginalError", async () => {
    connection.rollback.mockRejectedValue(new Error("Connection lost"));

    await expect(
      transact(fakeConnection(connection), async () => {
        throw new Error("MATCH_NOT_FOUND");
      }),
    ).rejects.toThrow("MATCH_NOT_FOUND");

    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(discardBotLogs).toHaveBeenCalledTimes(1);
  });

  it("transact_commitFails_rollsBackAndRethrows", async () => {
    connection.commit.mockRejectedValue(new Error("commit failed"));

    await expect(transact(fakeConnection(connection), async () => 1)).rejects.toThrow("commit failed");

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(flushBotLogs).not.toHaveBeenCalled();
  });
});

describe("inTransaction", () => {
  it("inTransaction_runSucceeds_usesPooledConnection", async () => {
    const actual = await inTransaction(async () => "ok");

    expect(actual).toBe("ok");
    expect(withConnection).toHaveBeenCalledTimes(1);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  });
});
