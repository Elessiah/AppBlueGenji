import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "mysql2/promise";
import { NamedLockUnavailableError } from "@/lib/server/named-lock";
import { SEED_LOCK_NAME, SEED_LOCK_TIMEOUT_SECONDS, withSeedLock } from "@/lib/server/seed-lock";

/**
 * Deux `npm run seed` lancés ensemble sur la même base s'effaçaient l'un
 * l'autre : le nettoyage du second détruisait les tournois que le premier était
 * en train de jouer (`ER_NO_REFERENCED_ROW_2` sur `bg_endurance_standings`,
 * entre autres symptômes changeant d'une exécution à l'autre).
 */

type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

function fakePool(options: { free?: unknown; acquired?: unknown } = {}) {
  const { free = 1, acquired = 1 } = options;
  const connection = {
    query: jest.fn<Query>(async (sql: string) =>
      sql.includes("GET_LOCK") ? [[{ acquired }], []] : [[], []],
    ),
    release: jest.fn<() => void>(),
    destroy: jest.fn<() => void>(),
  };
  const poolQuery = jest.fn<Query>(async () => [[{ free }], []]);
  const pool = {
    query: poolQuery,
    getConnection: jest.fn(async () => connection),
  } as unknown as Pool;
  return { pool, connection, poolQuery };
}

describe("withSeedLock", () => {
  it("joue le seed sous le verrou nommé du seed, puis le rend", async () => {
    const { pool, connection } = fakePool();
    const order: string[] = [];
    connection.query.mockImplementation(async (sql: string) => {
      order.push(sql.includes("GET_LOCK") ? "get" : "release");
      return sql.includes("GET_LOCK") ? [[{ acquired: 1 }], []] : [[], []];
    });

    const result = await withSeedLock(pool, async () => {
      order.push("seed");
      return 42;
    });

    expect(result).toBe(42);
    expect(order).toEqual(["get", "seed", "release"]);
    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining("GET_LOCK"), [
      SEED_LOCK_NAME,
      SEED_LOCK_TIMEOUT_SECONDS,
    ]);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("annonce l'attente quand un autre seed tient déjà le verrou", async () => {
    const { pool, poolQuery } = fakePool({ free: 0 });
    const onWait = jest.fn<() => void>();

    await withSeedLock(pool, async () => undefined, onWait);

    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("IS_FREE_LOCK"), [SEED_LOCK_NAME]);
    expect(onWait).toHaveBeenCalledTimes(1);
  });

  it.each<[string, unknown]>([
    ["libre", 1],
    ["en erreur (NULL)", null],
    ["illisible", undefined],
  ])("n'annonce aucune attente quand le verrou est %s", async (_label, free) => {
    const { pool } = fakePool({ free });
    const onWait = jest.fn<() => void>();

    await withSeedLock(pool, async () => undefined, onWait);

    expect(onWait).not.toHaveBeenCalled();
  });

  it("n'exige pas de rappel d'attente", async () => {
    const { pool } = fakePool({ free: 0 });
    await expect(withSeedLock(pool, async () => "ok")).resolves.toBe("ok");
  });

  it("ne joue pas le seed quand le verrou n'est pas obtenu dans le délai", async () => {
    const { pool } = fakePool({ free: 0, acquired: 0 });
    const run = jest.fn(async () => undefined);

    await expect(withSeedLock(pool, run)).rejects.toBeInstanceOf(NamedLockUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  it("rend le verrou même quand le seed échoue", async () => {
    const { pool, connection } = fakePool();

    await expect(
      withSeedLock(pool, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(connection.query).toHaveBeenCalledWith(expect.stringContaining("RELEASE_LOCK"), [SEED_LOCK_NAME]);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("attend plus longtemps qu'un seed complet", () => {
    // Un seed dure une trentaine de secondes : un délai plus court ferait
    // échouer le second seed au lieu de le faire attendre.
    expect(SEED_LOCK_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(300);
  });
});

describe("seed.ts", () => {
  const source = readFileSync(join(process.cwd(), "lib", "server", "seed.ts"), "utf8");

  it("efface et régénère sous le verrou, jamais avant de l'avoir pris", () => {
    expect(source).toMatch(/withSeedLock\(\s*db,\s*\(\) => seed\(db\)/);
    // Le nettoyage ne vit que dans la fonction jouée sous le verrou.
    const main = source.slice(source.indexOf("async function main("), source.indexOf("async function seed("));
    expect(main).not.toContain("clearDatabase(");
    expect(source.slice(source.indexOf("async function seed("))).toContain("await clearDatabase(db)");
  });
});
