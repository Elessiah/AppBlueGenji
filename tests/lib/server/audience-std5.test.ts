import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () => ({
  ...jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock"),
  withNamedLock: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/transaction");

import { mockPlanningClocks, type PlanningClockMocks } from "../../helpers/instrumentation-clocks";
import { AUDIENCE_ROLLUP_LOCK_NAME, audienceVisitorKey, openAudienceViews, resetAudienceState, rollUpAudienceDays } from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { fakeConnection, fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Cycle standard 5 de `feature/stats-page` (`docs/features/AUDIENCE_MEASUREMENT.md`) :
 * empreinte d'une adresse illisible, entrées d'un jour clos écartées avant les
 * plafonds, repli sous verrou nommé, horloge jamais lancée pendant `next build`.
 */

type InstrumentationModule = typeof import("@/instrumentation");

/** 2 h à Paris le 17 novembre : le 16 est clos (repliable dès 1 h 15). */
const AFTER_CLOSE = new Date("2026-11-17T01:00:00Z");
const HOUR = 3_600_000;

function database(): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (sql.includes("SELECT salt")) return [[{ salt: Buffer.alloc(32, 7) }]];
    if (sql.includes("GROUP BY day")) return [[]];
    return [{ affectedRows: 1 }];
  });
}

function mockDb(execute: SqlMock): Pool {
  const pool = fakePool({ execute });
  jest.mocked(getDatabase).mockResolvedValue(pool);
  return pool;
}

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("audienceVisitorKey — adresse illisible", () => {
  it("audienceVisitorKey_twoUnreadableAddresses_sameVisitorKey", async () => {
    mockDb(database());

    const first = await audienceVisitorKey("2026-11-17", "forged-value-1", "Firefox", AFTER_CLOSE);

    expect(await audienceVisitorKey("2026-11-17", "forged-value-2", "Firefox", AFTER_CLOSE)).toBe(first);
  });

  it("audienceVisitorKey_unreadableAndNull_sameVisitorKey", async () => {
    mockDb(database());

    const forged = await audienceVisitorKey("2026-11-17", "not an ip", "Firefox", AFTER_CLOSE);

    expect(await audienceVisitorKey("2026-11-17", null, "Firefox", AFTER_CLOSE)).toBe(forged);
  });

  it("audienceVisitorKey_ipv4_differsFromUnknownNetwork", async () => {
    mockDb(database());

    const unknown = await audienceVisitorKey("2026-11-17", "not an ip", "Firefox", AFTER_CLOSE);

    expect(await audienceVisitorKey("2026-11-17", "203.0.113.7", "Firefox", AFTER_CLOSE)).not.toBe(unknown);
  });
});

describe("openAudienceViews", () => {
  it("openAudienceViews_entryOpenedOnClosedDay_dropped", () => {
    // Ouverte 3 h plus tôt : le 16 à 23 h, heure de Paris.
    expect(openAudienceViews([{ openedAgeMs: 3 * HOUR }], AFTER_CLOSE)).toEqual([]);
  });

  it("openAudienceViews_entryOpenedToday_kept", () => {
    expect(openAudienceViews([{ openedAgeMs: HOUR }], AFTER_CLOSE)).toEqual([{ openedAgeMs: HOUR }]);
  });

  it("openAudienceViews_mixedBatch_keepsOnlyOpenDayInOrder", () => {
    const today = { openedAgeMs: 0, id: "a" };
    const yesterday = { openedAgeMs: 5 * HOUR, id: "b" };
    const later = { openedAgeMs: 60_000, id: "c" };

    expect(openAudienceViews([today, yesterday, later], AFTER_CLOSE)).toEqual([today, later]);
  });
});

describe("rollUpAudienceDays — verrou nommé", () => {
  it("rollUpAudienceDays_lockHeldElsewhere_returnsZeroWithoutReading", async () => {
    const execute = database();
    mockDb(execute);
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError(AUDIENCE_ROLLUP_LOCK_NAME, 0));

    await expect(rollUpAudienceDays(AFTER_CLOSE)).resolves.toBe(0);

    expect(execute).not.toHaveBeenCalled();
  });

  it("rollUpAudienceDays_lockObtained_readsUnderRollupLockWithoutWaiting", async () => {
    const execute = database();
    const pool = mockDb(execute);
    jest
      .mocked(withNamedLock)
      .mockImplementation(<T>(_pool: Pool, _name: string, _timeout: number, run: (connection: PoolConnection) => Promise<T>) => run(fakeConnection({})));

    await expect(rollUpAudienceDays(AFTER_CLOSE)).resolves.toBe(0);

    expect(jest.mocked(withNamedLock).mock.calls[0].slice(0, 3)).toEqual([pool, "bg_audience_rollup", 0]);
    expect(execute.mock.calls.some(([sql]) => sql.includes("GROUP BY day"))).toBe(true);
  });

  it("rollUpAudienceDays_otherLockError_rethrows", async () => {
    mockDb(database());
    jest.mocked(withNamedLock).mockRejectedValue(new Error("connection lost"));

    await expect(rollUpAudienceDays(AFTER_CLOSE)).rejects.toThrow("connection lost");
  });
});

describe("instrumentation — phase de construction", () => {
  const saved = { runtime: process.env.NEXT_RUNTIME, phase: process.env.NEXT_PHASE };

  afterEach(() => {
    if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = saved.runtime;
    if (saved.phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = saved.phase;
  });

  let clocks: PlanningClockMocks;

  function loadInstrumentation(startClock: () => void): InstrumentationModule {
    const loaded: InstrumentationModule[] = [];
    // `register` importe ses étapes après coup, hors du bac isolé : le registre
    // commun ne doit pas garder les doubles d'un test précédent.
    jest.resetModules();
    jest.isolateModules(() => {
      clocks = mockPlanningClocks();
      jest.doMock("@/lib/server/bot-log-shutdown", () => ({ installBotLogShutdownFlush: jest.fn() }));
      jest.doMock("@/lib/server/audience-service", () => ({ startAudienceMaintenanceClock: startClock }));
      loaded.push(jest.requireActual<InstrumentationModule>("@/instrumentation"));
    });
    return loaded[0];
  }

  it("register_productionBuildPhase_doesNotStartAudienceClock", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    const startClock = jest.fn();

    await loadInstrumentation(startClock).register();

    expect(startClock).not.toHaveBeenCalled();
  });

  it("register_serverRuntime_startsAudienceClock", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    const startClock = jest.fn();

    await loadInstrumentation(startClock).register();

    expect(startClock).toHaveBeenCalledTimes(1);
  });

  it("register_productionBuildPhase_startsNoPlanningClock", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";

    await loadInstrumentation(jest.fn()).register();

    expect(clocks.retention).not.toHaveBeenCalled();
    expect(clocks.autoConfirm).not.toHaveBeenCalled();
  });

  it("register_serverRuntime_startsEveryPlanningClock", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;

    await loadInstrumentation(jest.fn()).register();

    expect(clocks.retention).toHaveBeenCalledTimes(1);
    expect(clocks.notices).toHaveBeenCalledTimes(1);
    expect(clocks.deadlines).toHaveBeenCalledTimes(1);
    expect(clocks.autoConfirm).toHaveBeenCalledTimes(1);
  });

  it("register_autoConfirmClockThrows_logsAndResolves", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    const instrumentation = loadInstrumentation(jest.fn());
    clocks.autoConfirm.mockImplementation(() => {
      throw new TypeError("boom");
    });

    await expect(instrumentation.register()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith("[planning] Confirmation d'office non lancée.", "TypeError");
    expect(clocks.deadlines).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
