import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, PoolOptions } from "mysql2/promise";
import type { OnceGate } from "@/lib/server/migration-lock";
import { randomUUID } from "node:crypto";
import { fakePool } from "../../helpers/sql-double";

const createPool = jest.fn<(options: PoolOptions) => Pool>();
const runGate = jest.fn<OnceGate["run"]>(async () => undefined);

jest.mock("mysql2/promise", () => ({
  __esModule: true,
  default: { createPool: (options: PoolOptions) => createPool(options) },
}));
// Le schéma n'est pas joué ici : seule compte la création du pool.
jest.mock("@/lib/server/migration-lock", () => ({
  createOnceGate: (): OnceGate => ({ run: (task) => runGate(task) }),
  withMigrationLock: jest.fn(),
}));

import { DB_KEEPALIVE_INITIAL_DELAY_MS, getDatabase } from "@/lib/server/database";

const ENV = { DB_HOST: "db.test", DB_USER: "app", DB_PASSWORD: randomUUID(), DB_DATABASE: "bluegenji" };
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getDatabase", () => {
  it("crée le pool une seule fois, puis le rend tel quel", async () => {
    const pool = fakePool({});
    createPool.mockReturnValue(pool);

    await expect(getDatabase()).resolves.toBe(pool);
    await expect(getDatabase()).resolves.toBe(pool);

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ host: "db.test", user: "app", database: "bluegenji", charset: "utf8mb4" }),
    );
    // Sondes TCP dès 30 s : une connexion à moitié ouverte finit par lever une erreur.
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ enableKeepAlive: true, keepAliveInitialDelay: DB_KEEPALIVE_INITIAL_DELAY_MS }),
    );
    expect(DB_KEEPALIVE_INITIAL_DELAY_MS).toBe(30_000);
    // La porte des migrations est franchie à chaque appel (elle seule mémorise).
    expect(runGate).toHaveBeenCalledTimes(2);
  });

  it("getDatabase_newConnection_setsEnglishServerMessages", async () => {
    // Pool neuf : le module est rechargé pour ne pas reprendre celui du test d'avant.
    let listener: ((connection: unknown) => void) | undefined;
    const on = jest.fn((event: string, handler: (connection: unknown) => void) => {
      if (event === "connection") listener = handler;
    });
    createPool.mockReturnValue(fakePool({ on }));
    let fresh: typeof getDatabase = getDatabase;
    jest.isolateModules(() => {
      fresh = (jest.requireActual("@/lib/server/database") as { getDatabase: typeof getDatabase }).getDatabase;
    });

    await fresh();
    const query = jest.fn((_sql: string, done: (error: Error | null) => void) => done(null));
    listener?.({ query });

    expect(on).toHaveBeenCalledWith("connection", expect.any(Function));
    expect(query).toHaveBeenCalledWith("SET SESSION lc_messages = 'en_US'", expect.any(Function));
    // Un ALTER du démarrage ne fige plus le site derrière une transaction longue.
    expect(query).toHaveBeenCalledWith("SET SESSION lock_wait_timeout = 50", expect.any(Function));
  });

  it("getDatabase_sessionSettingFails_onlyWarns", async () => {
    let listener: ((connection: unknown) => void) | undefined;
    const on = jest.fn((event: string, handler: (connection: unknown) => void) => {
      if (event === "connection") listener = handler;
    });
    createPool.mockReturnValue(fakePool({ on }));
    let fresh: typeof getDatabase = getDatabase;
    jest.isolateModules(() => {
      fresh = (jest.requireActual("@/lib/server/database") as { getDatabase: typeof getDatabase }).getDatabase;
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await fresh();
    const query = jest.fn((_sql: string, done: (error: Error | null) => void) => done(new Error("denied")));
    expect(() => listener?.({ query })).not.toThrow();

    expect(warn).toHaveBeenCalledWith("[db] lc_messages non réglé sur la connexion", "Error");
    expect(warn).toHaveBeenCalledWith("[db] lock_wait_timeout non réglé sur la connexion", "Error");
    warn.mockRestore();
  });
});
