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

import { getDatabase } from "@/lib/server/database";

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
    // La porte des migrations est franchie à chaque appel (elle seule mémorise).
    expect(runGate).toHaveBeenCalledTimes(2);
  });
});
