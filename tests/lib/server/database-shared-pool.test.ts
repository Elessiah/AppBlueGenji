import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, PoolOptions } from "mysql2/promise";
import type { OnceGate } from "@/lib/server/migration-lock";
import { randomUUID } from "node:crypto";
import { fakePool } from "../../helpers/sql-double";

/**
 * Pool partagé par les copies du module dans le serveur du site
 * (`NEXT_RUNTIME`) : l'horloge d'entretien de la mesure d'audience, chargée par
 * `instrumentation.ts`, n'ouvre pas un second pool (`database.ts`).
 */

const createPool = jest.fn<(options: PoolOptions) => Pool>();

jest.mock("mysql2/promise", () => ({
  __esModule: true,
  default: { createPool: (options: PoolOptions) => createPool(options) },
}));
jest.mock("@/lib/server/migration-lock", () => ({
  createOnceGate: (): OnceGate => ({ run: async () => undefined }),
  withMigrationLock: jest.fn(),
}));

type DatabaseModule = typeof import("@/lib/server/database");

const ENV = { DB_HOST: "db.test", DB_USER: "app", DB_PASSWORD: randomUUID(), DB_DATABASE: "bluegenji" };
const KEYS = [...Object.keys(ENV), "NEXT_RUNTIME"];
const saved: Record<string, string | undefined> = {};
const state = globalThis as typeof globalThis & {
  __bgDatabase?: unknown;
  __bgDeletedAccountsReconciliation?: Promise<void>;
  __bgDueDeletionsAt?: number;
};

/** Une copie neuve du module, comme celle des routes ou d'`instrumentation.ts`. */
function moduleCopy(): DatabaseModule {
  const loaded: DatabaseModule[] = [];
  jest.isolateModules(() => {
    loaded.push(jest.requireActual<DatabaseModule>("@/lib/server/database"));
  });
  return loaded[0];
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  Object.assign(process.env, ENV);
  createPool.mockImplementation(() => fakePool({ on: jest.fn() }));
  // Les passes de fond du serveur (rattrapage, suppressions dues) ne concernent pas ce test.
  state.__bgDeletedAccountsReconciliation = Promise.resolve();
  state.__bgDueDeletionsAt = Date.now();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  delete state.__bgDatabase;
  delete state.__bgDeletedAccountsReconciliation;
  delete state.__bgDueDeletionsAt;
  createPool.mockReset();
});

describe("getDatabase — copies du module", () => {
  it("getDatabase_serverRuntimeTwoModuleCopies_onePool", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const routes = moduleCopy();
    const instrumentation = moduleCopy();

    const first = await routes.getDatabase();
    const second = await instrumentation.getDatabase();

    expect(second).toBe(first);
    expect(createPool).toHaveBeenCalledTimes(1);
  });

  it("getDatabase_outsideServer_poolPerCopy", async () => {
    delete process.env.NEXT_RUNTIME;
    const script = moduleCopy();
    const other = moduleCopy();

    await script.getDatabase();
    await other.getDatabase();

    expect(createPool).toHaveBeenCalledTimes(2);
    expect(state.__bgDatabase).toBeUndefined();
  });
});
