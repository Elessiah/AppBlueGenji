import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, PoolOptions } from "mysql2/promise";
import { fakePool } from "../../helpers/sql-double";

/*
 * Le passage horaire des suppressions de compte tourne derrière un verrou
 * nommé (`GET_LOCK`, sans attente) : un seul processus du site à la fois fait
 * le travail ; les autres passent leur tour sans bruit.
 */

const createPool = jest.fn<(options: PoolOptions) => Pool>();
const withNamedLock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const settleDeletedSoloEntries = jest.fn<() => Promise<{ withdrawn: number; forfeited: number }>>();
const finalizeDueAccountDeletions = jest.fn<() => Promise<{ finalized: number; failed: number }>>();

jest.mock("mysql2/promise", () => ({
  __esModule: true,
  default: { createPool: (options: PoolOptions) => createPool(options) },
}));
jest.mock("@/lib/server/database/run-migrations", () => ({ runMigrations: async () => undefined }));
jest.mock("@/lib/server/migration-lock", () => ({
  createOnceGate: () => ({ run: (task: () => Promise<unknown>) => task() }),
  withMigrationLock: (_pool: Pool, run: () => Promise<unknown>) => run(),
}));
jest.mock("@/lib/server/named-lock", () => {
  class NamedLockUnavailableError extends Error {}
  return { NamedLockUnavailableError, withNamedLock: (...args: unknown[]) => withNamedLock(...args) };
});
jest.mock("@/lib/server/users/deleted-solo-entries", () => ({
  settleDeletedSoloEntries: () => settleDeletedSoloEntries(),
}));
jest.mock("@/lib/server/users/deleted-accounts", () => ({
  finalizeDueAccountDeletions: () => finalizeDueAccountDeletions(),
  reconcileDeletedAccounts: async () => ({ erased: 0, renamed: 0, failed: 0 }),
}));

import { DUE_DELETIONS_LOCK_NAME, getDatabase, runDueAccountDeletionsExclusively } from "@/lib/server/database";
import { NamedLockUnavailableError } from "@/lib/server/named-lock";

const ENV = { DB_HOST: "db.test", DB_USER: "app", DB_PASSWORD: "x", DB_DATABASE: "bluegenji" };

beforeEach(async () => {
  jest.clearAllMocks();
  Object.assign(process.env, ENV);
  createPool.mockReturnValue(fakePool({ execute: jest.fn(async () => [[], undefined]) }));
  settleDeletedSoloEntries.mockResolvedValue({ withdrawn: 0, forfeited: 0 });
  finalizeDueAccountDeletions.mockResolvedValue({ finalized: 0, failed: 0 });
  // Le verrou obtenu : la tâche est jouée.
  withNamedLock.mockImplementation(async (...args: unknown[]) => (args[3] as (c: unknown) => Promise<unknown>)({}));
  await getDatabase();
});

describe("runDueAccountDeletionsExclusively", () => {
  it("runDueAccountDeletionsExclusively_lockHeldElsewhere_skipsBothSteps", async () => {
    withNamedLock.mockRejectedValue(new NamedLockUnavailableError("bg_due_account_deletions", 0));

    await expect(runDueAccountDeletionsExclusively()).resolves.toBeUndefined();

    expect(settleDeletedSoloEntries).not.toHaveBeenCalled();
    expect(finalizeDueAccountDeletions).not.toHaveBeenCalled();
  });

  it("runDueAccountDeletionsExclusively_lockAcquired_takesItWithoutWaitingThenSettlesAndFinalizes", async () => {
    await runDueAccountDeletionsExclusively();

    expect(withNamedLock.mock.calls[0].slice(1, 3)).toEqual([DUE_DELETIONS_LOCK_NAME, 0]);
    expect(settleDeletedSoloEntries).toHaveBeenCalledTimes(1);
    expect(finalizeDueAccountDeletions).toHaveBeenCalledTimes(1);
  });

  it("runDueAccountDeletionsExclusively_settleFails_stillFinalizesAndSaysIt", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    settleDeletedSoloEntries.mockRejectedValue(new Error("DB_DOWN"));

    await runDueAccountDeletionsExclusively();

    expect(finalizeDueAccountDeletions).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[deleted-accounts] Forfaits des comptes supprimés reportés :", "DB_DOWN");
    errorSpy.mockRestore();
  });

  it("runDueAccountDeletionsExclusively_otherLockError_propagates", async () => {
    withNamedLock.mockRejectedValue(new Error("DB_DOWN"));

    await expect(runDueAccountDeletionsExclusively()).rejects.toThrow("DB_DOWN");
  });
});
