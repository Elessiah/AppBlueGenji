import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/users/deleted-solo-entries", () => ({ settleDeletedSoloEntries: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { settleDeletedSoloEntries } from "@/lib/server/users/deleted-solo-entries";
import { DELETED_ACCOUNTS_FULL_SCAN_HOURS, reconcileStaleFullScan } from "@/lib/server/users/deleted-accounts";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * EF-62 (revue performance, cycle 1) : le relevé complet n'attend plus un
 * redémarrage — le passage horaire le mène, au plus une fois par jour.
 */

const DAY_MS = DELETED_ACCOUNTS_FULL_SCAN_HOURS * 3_600_000;
const state = globalThis as { __bgDeletedAccountsFullScanAt?: number };

function mockDb(markerFresh: boolean) {
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (String(sql).includes("FROM bg_settings")) return [markerFresh ? [{ one: 1 }] : []];
    return [[]];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn() }));
  return execute;
}

beforeEach(() => {
  jest.clearAllMocks();
  state.__bgDeletedAccountsFullScanAt = undefined;
  jest.mocked(settleDeletedSoloEntries).mockResolvedValue({ withdrawn: 0, forfeited: 0 });
});

describe("reconcileStaleFullScan", () => {
  it("reconcileStaleFullScan_markerFresh_returnsNullAndScansNothing", async () => {
    const execute = mockDb(true);

    expect(await reconcileStaleFullScan()).toBeNull();

    expect(execute.mock.calls.some(([q]) => String(q).includes("SELECT u.id"))).toBe(false);
  });

  it("reconcileStaleFullScan_markerStale_runsFullScanWithoutSoloPass", async () => {
    const execute = mockDb(false);

    const outcome = await reconcileStaleFullScan();

    expect(outcome).toEqual({ erased: 0, renamed: 0, failed: 0, withdrawn: 0, forfeited: 0 });
    expect(settleDeletedSoloEntries).not.toHaveBeenCalled();
    const scan = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes("SELECT u.id"));
    expect(scan).toContain("NOT (");
  });

  it("reconcileStaleFullScan_attemptedWithinTheDay_returnsNullWithoutReading", async () => {
    const execute = mockDb(false);
    const start = 10 * DAY_MS;
    state.__bgDeletedAccountsFullScanAt = start;

    expect(await reconcileStaleFullScan(start + DAY_MS - 1)).toBeNull();

    expect(execute).not.toHaveBeenCalled();
  });

  it("reconcileStaleFullScan_attemptOlderThanADay_readsMarkerAgain", async () => {
    const execute = mockDb(true);
    const start = 10 * DAY_MS;
    state.__bgDeletedAccountsFullScanAt = start;

    expect(await reconcileStaleFullScan(start + DAY_MS)).toBeNull();

    expect(execute).toHaveBeenCalledTimes(1);
  });
  // Revue sécurité cycle 1 : le marqueur n'est lu qu'une fois par relevé.
  it("reconcileStaleFullScan_markerStale_readsMarkerOnce", async () => {
    const execute = mockDb(false);

    await reconcileStaleFullScan();

    const markerReads = execute.mock.calls.filter(([q]) => String(q).includes("SELECT 1 FROM bg_settings"));
    expect(markerReads).toHaveLength(1);
  });
});
