import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () =>
  jest.requireActual<typeof import("../../helpers/named-lock-passthrough")>("../../helpers/named-lock-passthrough").namedLockPassThrough(),
);
jest.mock("@/lib/server/tournaments/transaction");

import {
  MAINTENANCE_INTERVAL_MS,
  MAINTENANCE_TIMEOUT_MS,
  getAudienceStats,
  maintainAudience,
  resetAudienceState,
  runMaintenance,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Cycle de sécurité 5 de `feature/stats-page` : un entretien figé est borné
 * (`MAINTENANCE_TIMEOUT_MS`), un repli en panne se journalise à chaque jour de
 * plus, et le cache de la page tombe quand un autre processus a replié
 * (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

const SALT = Buffer.alloc(32, 7);
const NOON = new Date("2026-11-16T12:00:00Z");
const NEXT_NOON = new Date("2026-11-17T12:00:00Z");
const STATS_MARKER = "FROM bg_audience_days\n      ORDER BY day";

interface Options {
  rollableDays?: readonly string[];
  lastRolled?: () => string | null;
  failOn?: readonly string[];
}

function database({ rollableDays = [], lastRolled = () => null, failOn = [] }: Options = {}): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (failOn.some((part) => sql.includes(part))) throw new Error("db down");
    if (sql.includes("MAX(day)") && sql.includes("FROM bg_audience_days")) return [[{ day: lastRolled() }]];
    if (sql.includes("SELECT salt")) return [[{ salt: SALT }]];
    if (sql.includes("GROUP BY day")) return [rollableDays.map((day) => ({ day }))];
    if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
    return [[]];
  });
}

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function calls(execute: SqlMock, part: string) {
  return execute.mock.calls.filter(([sql]) => sql.includes(part));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("entretien borné", () => {
  it("maintainAudience_stepHangs_clearedAfterTimeoutAndNextPassRuns", async () => {
    jest.useFakeTimers({ now: NOON, doNotFake: ["setImmediate", "nextTick"] });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database({ rollableDays: ["2026-11-15"] }));
    jest.mocked(inTransaction).mockReturnValue(new Promise<never>(() => undefined));
    maintainAudience(NOON);
    await settle();

    await jest.advanceTimersByTimeAsync(MAINTENANCE_TIMEOUT_MS);
    const execute = database();
    mockDb(execute);
    maintainAudience(new Date(NOON.getTime() + MAINTENANCE_INTERVAL_MS));
    await settle();

    expect(errorSpy).toHaveBeenCalledWith("[audience] Entretien interrompu.", expect.stringContaining("audience-service"));
    expect(calls(execute, "DELETE FROM bg_audience_salts")).toHaveLength(1);
  });
});

describe("repli en panne", () => {
  it("runMaintenance_rollupFailsOnNewDay_loggedAgainOncePerDay", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database({ rollableDays: ["2026-11-14"] }));
    jest.mocked(inTransaction).mockRejectedValue(new Error("db down"));

    await expect(runMaintenance(NOON)).rejects.toThrow("db down");
    await expect(runMaintenance(NOON)).rejects.toThrow("db down");
    await expect(runMaintenance(NEXT_NOON)).rejects.toThrow("db down");

    const rollupLogs = errorSpy.mock.calls.map(([message]) => String(message)).filter((message) => message.startsWith("[audience] Repli"));
    expect(rollupLogs).toEqual([
      "[audience] Repli des jours clos impossible (jusqu'au 2026-11-15).",
      "[audience] Repli des jours clos impossible (jusqu'au 2026-11-16).",
    ]);
  });
});

describe("repli fait par un autre processus", () => {
  it("getAudienceStats_lastRolledDayChangedElsewhere_cacheDropped", async () => {
    let lastRolled: string | null = "2026-11-14";
    const execute = database({ lastRolled: () => lastRolled });
    mockDb(execute);
    await runMaintenance(NOON);
    await getAudienceStats(NOON);
    await settle();

    lastRolled = "2026-11-15";
    await runMaintenance(NOON);
    await getAudienceStats(NOON);

    expect(calls(execute, STATS_MARKER)).toHaveLength(2);
  });

  it("getAudienceStats_lastRolledDayUnchanged_cacheKept", async () => {
    const execute = database({ lastRolled: () => "2026-11-14" });
    mockDb(execute);
    await runMaintenance(NOON);
    await getAudienceStats(NOON);
    await settle();

    await runMaintenance(NOON);
    await getAudienceStats(NOON);

    expect(calls(execute, STATS_MARKER)).toHaveLength(1);
  });

  it("runMaintenance_lastRolledDayReadFails_resolvesAndKeepsCache", async () => {
    mockDb(database());
    await getAudienceStats(NOON);
    await settle();
    const execute = database({ failOn: ["MAX(day)"] });
    mockDb(execute);

    await expect(runMaintenance(NOON)).resolves.toBeUndefined();
    await getAudienceStats(NOON);

    expect(calls(execute, STATS_MARKER)).toHaveLength(0);
  });
});
