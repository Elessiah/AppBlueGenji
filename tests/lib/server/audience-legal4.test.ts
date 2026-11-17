import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/transaction");

import {
  getAudienceStats,
  maintainAudience,
  resetAudienceState,
  runMaintenance,
  sharedAudienceState,
} from "@/lib/server/audience-service";
import { getDatabase } from "@/lib/server/database";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import { fakePool, type SqlMock, type SqlQuery } from "../../helpers/sql-double";

/**
 * Cycle juridique 4 de `feature/stats-page` : état complété après un
 * rechargement à chaud, journal des sels par jour, erreur imprévue de
 * l'entretien journalisée, repli partiel qui vide le cache, et `register` dont
 * chaque étape échoue seule (`docs/features/AUDIENCE_MEASUREMENT.md`).
 */

type InstrumentationModule = typeof import("@/instrumentation");

const SALT = Buffer.alloc(32, 7);
const NOON = new Date("2026-11-16T12:00:00Z");
const NEXT_NOON = new Date("2026-11-17T12:00:00Z");

/** Base vide au sel `SALT` ; `failOn` fait échouer les requêtes qui le contiennent. */
function database(failOn: readonly string[] = [], rollableDays: readonly string[] = []): SqlMock {
  return jest.fn<SqlQuery>(async (sql: string) => {
    if (failOn.some((part) => sql.includes(part))) throw new Error("db down");
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

/** Laisse finir un entretien lancé sans être attendu (`maintainAudience`). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

const audienceGlobal = globalThis as typeof globalThis & { __bgAudienceState?: object };

beforeEach(() => {
  resetAudienceState();
  jest.clearAllMocks();
});

afterEach(() => {
  resetAudienceState();
  jest.restoreAllMocks();
});

describe("sharedAudienceState", () => {
  it("sharedAudienceState_staleStateMissingFailing_fillsFieldKeepsIdentity", () => {
    const stale = sharedAudienceState() as unknown as Record<string, unknown>;
    const pending = stale.pending;
    delete stale.failing;

    const state = sharedAudienceState();

    expect(state).toBe(audienceGlobal.__bgAudienceState);
    expect(state).toBe(stale);
    expect(state.failing).toEqual(new Map());
    expect(state.pending).toBe(pending);
  });
});

describe("journal de l'entretien", () => {
  it("runMaintenance_saltDeleteFailsOnTwoDays_logsEachDay", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(["DELETE FROM bg_audience_salts"]));

    await expect(runMaintenance(NOON)).rejects.toThrow("db down");
    await expect(runMaintenance(NOON)).rejects.toThrow("db down");
    await expect(runMaintenance(NEXT_NOON)).rejects.toThrow("db down");

    expect(errorSpy.mock.calls.map(([message]) => message)).toEqual([
      "[audience] Sels jusqu'au 2026-11-15 non effacés.",
      "[audience] Sels jusqu'au 2026-11-16 non effacés.",
    ]);
  });

  it("runMaintenance_stepRejectsWithNull_logsAndRejects", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>(async (sql: string) => {
      if (sql.startsWith("DELETE FROM bg_audience_views")) return Promise.reject(null);
      if (sql.startsWith("DELETE")) return [{ affectedRows: 0 }];
      return [[]];
    });
    mockDb(execute);

    await expect(runMaintenance(NOON)).rejects.toBeNull();

    expect(errorSpy).toHaveBeenCalledWith("[audience] Purge du détail impossible.", "erreur inconnue");
  });

  it("maintainAudience_unexpectedError_logsInterrupted", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database(["DELETE FROM bg_audience_views"]));
    const state = sharedAudienceState();
    const failing = state.failing;
    state.failing = {
      get: () => {
        throw new TypeError("broken state");
      },
    } as unknown as Map<"rollup" | "salts" | "purge", string>;

    try {
      maintainAudience(NOON);
      await settle();
    } finally {
      state.failing = failing;
    }

    expect(errorSpy).toHaveBeenCalledWith("[audience] Entretien interrompu.", expect.stringContaining("TypeError"));
  });
});

describe("repli partiel", () => {
  it("runMaintenance_rollupFailsAfterFirstDay_invalidatesStatsCache", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb(database());
    jest.mocked(inTransaction).mockResolvedValue(undefined);
    await getAudienceStats(NOON);
    await settle();
    const execute = database([], ["2026-11-14", "2026-11-15"]);
    mockDb(execute);
    jest.mocked(inTransaction).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db down"));
    await expect(runMaintenance(NOON)).rejects.toThrow("db down");

    await getAudienceStats(NOON);

    expect(calls(execute, "FROM bg_audience_days\n      ORDER BY day")).toHaveLength(1);
  });
});

describe("instrumentation", () => {
  const runtime = process.env.NEXT_RUNTIME;

  afterEach(() => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
  });

  function loadInstrumentation(botLog: () => void, clock: () => void): InstrumentationModule {
    const loaded: InstrumentationModule[] = [];
    // `register` importe ses étapes après coup, hors du bac isolé : le registre
    // commun ne doit pas garder les doubles du test précédent.
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock("@/lib/server/bot-log-shutdown", () => ({ installBotLogShutdownFlush: botLog }));
      jest.doMock("@/lib/server/audience-service", () => ({ startAudienceMaintenanceClock: clock }));
      loaded.push(jest.requireActual<InstrumentationModule>("@/instrumentation"));
    });
    return loaded[0];
  }

  it("register_botLogShutdownThrows_stillStartsAudienceClock", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = "nodejs";
    const clock = jest.fn();
    const instrumentation = loadInstrumentation(() => {
      throw new TypeError("boom");
    }, clock);

    await expect(instrumentation.register()).resolves.toBeUndefined();

    expect(clock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[bot-logs] Envoi des lots à l'arrêt non branché.", "TypeError");
  });

  it("register_audienceClockThrowsCodedError_logsCode", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.NEXT_RUNTIME = "nodejs";
    const instrumentation = loadInstrumentation(jest.fn(), () => {
      throw Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" });
    });

    await instrumentation.register();

    expect(errorSpy).toHaveBeenCalledWith("[audience] Horloge d'entretien non lancée.", "ECONNREFUSED");
  });
});
