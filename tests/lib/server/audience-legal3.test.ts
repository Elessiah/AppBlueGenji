import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () =>
  jest.requireActual<typeof import("../../helpers/named-lock-passthrough")>("../../helpers/named-lock-passthrough").namedLockPassThrough(),
);
jest.mock("@/lib/server/tournaments/transaction");

import { mockPlanningClocks } from "../../helpers/instrumentation-clocks";
import {
  MAINTENANCE_CLOCK_TICK_MS,
  MAINTENANCE_INTERVAL_MS,
  maintainAudience,
  pendingAudienceCount,
  recordAudienceViews,
  resetAudienceState,
  runMaintenance,
  startAudienceMaintenanceClock,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { AUDIENCE_MAX_ENGAGED_MINUTES, AUDIENCE_MAX_ENGAGED_MS, type AudienceView } from "@/lib/shared/audience";
import { fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Cycle juridique 3 de `feature/stats-page` : l'état de la mesure est commun
 * aux copies du module (routes, `instrumentation.ts`), l'horloge bat plus vite
 * que l'entretien, une panne se journalise une fois, et `register` survit à
 * un échec de la mesure (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

type AudienceServiceModule = typeof import("@/lib/server/audience-service");
type DatabaseModule = typeof import("@/lib/server/database");
type InstrumentationModule = typeof import("@/instrumentation");

const SALT = Buffer.alloc(32, 7);
const NOON = new Date("2026-11-16T12:00:00Z");

function view(overrides: Partial<AudienceView> = {}): AudienceView {
  return { pageKey: "home", locale: "fr", device: "mobile", source: "direct", isView: true, engagedMs: 4000, ageMs: 0, openedAgeMs: 0, ...overrides };
}

/** Base vide au sel `SALT` ; `failOn` fait échouer les requêtes qui le contiennent. */
function database(failOn: readonly string[] = []): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (failOn.some((part) => sql.includes(part))) throw new Error("db down");
    if (sql.includes("SELECT salt")) return [[{ salt: SALT }]];
    if (sql.startsWith("DELETE") || sql.startsWith("INSERT")) return [{ affectedRows: 0 }];
    return [[]];
  });
}

function mockDb(execute: SqlMock) {
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function calls(execute: SqlMock, prefix: string) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith(prefix));
}

/** Seconde copie du module (comme celle d'`instrumentation.ts`), branchée sur la même base. */
function secondCopy(execute: SqlMock): AudienceServiceModule {
  const loaded: AudienceServiceModule[] = [];
  jest.isolateModules(() => {
    const db = jest.requireMock<DatabaseModule>("@/lib/server/database");
    jest.mocked(db.getDatabase).mockResolvedValue(fakePool({ execute }));
    loaded.push(jest.requireActual<AudienceServiceModule>("@/lib/server/audience-service"));
  });
  return loaded[0];
}

/** Laisse finir un entretien lancé sans être attendu (`maintainAudience`). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("état commun aux copies du module", () => {
  it("moduleState_secondModuleCopy_sharesPendingQueueWithClockCopy", async () => {
    const execute = database();
    mockDb(execute);
    await recordAudienceViews({ ip: "203.0.113.7", userAgent: "Firefox", views: [view()], now: NOON });
    const clockCopy = secondCopy(execute);

    await clockCopy.runMaintenance(NOON);

    expect(calls(execute, "INSERT INTO bg_audience_views")).toHaveLength(1);
    expect(pendingAudienceCount()).toBe(0);
  });

  it("startAudienceMaintenanceClock_secondModuleCopy_noSecondInterval", () => {
    jest.useFakeTimers({ now: NOON });
    const execute = database();
    mockDb(execute);
    startAudienceMaintenanceClock();
    const timers = jest.getTimerCount();

    secondCopy(execute).startAudienceMaintenanceClock();

    expect(jest.getTimerCount()).toBe(timers);
  });
});

describe("startAudienceMaintenanceClock — cadence", () => {
  it("startAudienceMaintenanceClock_trafficRunJustAfterStart_nextRunWithinIntervalPlusTick", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-17T00:20:00Z"), doNotFake: ["setImmediate", "nextTick"] });
    const execute = database();
    mockDb(execute);
    startAudienceMaintenanceClock();
    // Entretien entraîné par le trafic une milliseconde après le départ de
    // l'horloge (le minuteur, lui, ne bouge pas) : le passage tombé à
    // l'intervalle exact arrive une milliseconde trop tôt et passe son tour.
    await jest.advanceTimersByTimeAsync(1);
    maintainAudience();
    await settle();

    // Une horloge de dix minutes ne repasserait qu'à 20 min ; celle d'une minute repasse à 11 min.
    await jest.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS + MAINTENANCE_CLOCK_TICK_MS - 1);
    await settle();

    expect(calls(execute, "DELETE FROM bg_audience_salts")).toHaveLength(2);
  });
});

describe("journal de l'entretien", () => {
  it("maintainAudience_saltDeleteFails_logsOnce", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(["DELETE FROM bg_audience_salts"]));

    maintainAudience(NOON);
    await settle();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[audience] Sels jusqu'au 2026-11-15 non effacés.", expect.anything());
  });

  it("runMaintenance_consecutiveFailures_logsFirstOnly", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(["DELETE FROM bg_audience_views"]));

    await expect(runMaintenance(NOON)).rejects.toThrow("db down");
    await expect(runMaintenance(NOON)).rejects.toThrow("db down");

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("runMaintenance_failureThenSuccessThenFailure_logsAgain", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(["DELETE FROM bg_audience_views"]));
    await expect(runMaintenance(NOON)).rejects.toThrow("db down");
    mockDb(database());
    await runMaintenance(NOON);
    mockDb(database(["DELETE FROM bg_audience_views"]));

    await expect(runMaintenance(NOON)).rejects.toThrow("db down");

    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("runMaintenance_rollupFails_logsRollupFailure", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(["GROUP BY day"]));

    await expect(runMaintenance(NOON)).rejects.toThrow("db down");

    expect(errorSpy).toHaveBeenCalledWith("[audience] Repli des jours clos impossible (jusqu'au 2026-11-15).", expect.anything());
  });
});

describe("instrumentation", () => {
  const runtime = process.env.NEXT_RUNTIME;

  afterEach(() => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
  });

  it("register_audienceClockThrows_resolvesAndLogs", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = "nodejs";
    const loaded: InstrumentationModule[] = [];
    jest.isolateModules(() => {
      mockPlanningClocks();
      jest.doMock("@/lib/server/bot-log-shutdown", () => ({ installBotLogShutdownFlush: jest.fn() }));
      jest.doMock("@/lib/server/audience-service", () => ({
        startAudienceMaintenanceClock: () => {
          throw new TypeError("boom");
        },
      }));
      loaded.push(jest.requireActual<InstrumentationModule>("@/instrumentation"));
    });

    await expect(loaded[0].register()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith("[audience] Horloge d'entretien non lancée.", "TypeError");
  });
});

describe("AUDIENCE_MAX_ENGAGED_MINUTES", () => {
  it("AUDIENCE_MAX_ENGAGED_MINUTES_equalsMsCapInMinutes", () => {
    expect(AUDIENCE_MAX_ENGAGED_MINUTES).toBe(30);
    expect(AUDIENCE_MAX_ENGAGED_MINUTES * 60_000).toBe(AUDIENCE_MAX_ENGAGED_MS);
  });
});
