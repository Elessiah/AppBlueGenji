import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "mysql2/promise";
import {
  MIGRATION_LOCK_NAME,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  createOnceGate,
  withMigrationLock,
} from "@/lib/server/migration-lock";

/**
 * Le démarrage rejoue tout le schéma, et `next dev` lance plusieurs processus :
 * sans verrou nommé, deux `ALTER TABLE` concurrents sur la même table font
 * déclarer un interblocage par MySQL ; sans oubli des échecs, la victime restait
 * morte jusqu'au redémarrage du serveur.
 */

type FakeConnection = {
  query: jest.Mock<(sql: string, values?: unknown[]) => Promise<unknown>>;
  release: jest.Mock<() => void>;
  destroy: jest.Mock<() => void>;
};

function fakePool(acquired: unknown = 1): { pool: Pool; connection: FakeConnection } {
  const connection: FakeConnection = {
    query: jest.fn(async (sql: string) =>
      sql.includes("GET_LOCK") ? [[{ acquired }], []] : [[], []],
    ),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  const pool = {
    getConnection: jest.fn(async () => connection),
  } as unknown as Pool;
  return { pool, connection };
}

describe("withMigrationLock", () => {
  it("prend le verrou nommé, joue la tâche, puis le rend sur la même connexion", async () => {
    const { pool, connection } = fakePool();
    const order: string[] = [];
    connection.query.mockImplementation(async (sql: string) => {
      order.push(sql.includes("GET_LOCK") ? "get" : "release");
      return sql.includes("GET_LOCK") ? [[{ acquired: 1 }], []] : [[], []];
    });

    const result = await withMigrationLock(pool, async () => {
      order.push("migrations");
      return "fait";
    });

    expect(result).toBe("fait");
    expect(order).toEqual(["get", "migrations", "release"]);
    // Une seule connexion : le verrou est lié à la session, pas à la requête.
    expect((pool.getConnection as jest.Mock).mock.calls).toHaveLength(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("passe le nom et le délai d'attente à GET_LOCK", async () => {
    const { pool, connection } = fakePool();
    await withMigrationLock(pool, async () => undefined);

    expect(connection.query).toHaveBeenNthCalledWith(1, expect.stringContaining("GET_LOCK"), [
      MIGRATION_LOCK_NAME,
      MIGRATION_LOCK_TIMEOUT_SECONDS,
    ]);
    expect(connection.query).toHaveBeenNthCalledWith(2, expect.stringContaining("RELEASE_LOCK"), [
      MIGRATION_LOCK_NAME,
    ]);
  });

  it("rend le verrou même si les migrations échouent", async () => {
    const { pool, connection } = fakePool();
    const boom = new Error("ALTER TABLE a échoué");

    await expect(
      withMigrationLock(pool, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(connection.query.mock.calls[1]?.[0]).toContain("RELEASE_LOCK");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("refuse de jouer les migrations si le verrou n'est pas obtenu", async () => {
    const { pool, connection } = fakePool(0);
    const run = jest.fn(async () => undefined);

    await expect(withMigrationLock(pool, run)).rejects.toThrow(MIGRATION_LOCK_NAME);

    expect(run).not.toHaveBeenCalled();
    // Rien n'a été pris : rien à rendre, et la connexion retourne au pool.
    expect(connection.query).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("traite le NULL de GET_LOCK (erreur serveur) comme un échec", async () => {
    const { pool } = fakePool(null);
    await expect(withMigrationLock(pool, async () => undefined)).rejects.toThrow(
      MIGRATION_LOCK_NAME,
    );
  });

  it("détruit la connexion quand le verrou n'a pas pu être rendu", async () => {
    const { pool, connection } = fakePool();
    connection.query.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      throw new Error("connexion perdue");
    });

    await withMigrationLock(pool, async () => undefined);

    // Rendue au pool, elle garderait le verrou : c'est la fin de la session qui
    // le libère.
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it("ne masque pas l'erreur des migrations par celle du relâchement", async () => {
    const { pool, connection } = fakePool();
    const boom = new Error("ALTER TABLE a échoué");
    connection.query.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      throw new Error("connexion perdue");
    });

    await expect(
      withMigrationLock(pool, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("createOnceGate", () => {
  it("ne joue la tâche qu'une fois quand elle réussit", async () => {
    const gate = createOnceGate();
    const task = jest.fn(async () => undefined);

    await gate.run(task);
    await gate.run(task);
    await gate.run(task);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("partage la même promesse entre appels concurrents", async () => {
    const gate = createOnceGate();
    let resolve: (() => void) | null = null;
    const task = jest.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );

    const first = gate.run(task);
    const second = gate.run(task);
    expect(task).toHaveBeenCalledTimes(1);

    resolve!();
    await Promise.all([first, second]);
  });

  it("oublie un échec : l'appel suivant rejoue la tâche", async () => {
    const gate = createOnceGate();
    const task = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"))
      .mockResolvedValueOnce(undefined);

    await expect(gate.run(task)).rejects.toThrow("ER_LOCK_DEADLOCK");
    await expect(gate.run(task)).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(2);

    // Le succès, lui, est bien mémorisé.
    await gate.run(task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("propage l'échec à tous ceux qui attendaient", async () => {
    const gate = createOnceGate();
    const boom = new Error("échec de migration");
    const task = jest.fn(async () => {
      await Promise.resolve();
      throw boom;
    });

    const waiters = [gate.run(task), gate.run(task)];
    await expect(Promise.allSettled(waiters)).resolves.toEqual([
      { status: "rejected", reason: boom },
      { status: "rejected", reason: boom },
    ]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("n'efface pas la tentative en cours au rejet d'une précédente", async () => {
    const gate = createOnceGate();
    const first = jest.fn<() => Promise<void>>().mockRejectedValue(new Error("premier"));
    const second = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(gate.run(first)).rejects.toThrow("premier");
    await gate.run(second);
    await gate.run(second);

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("câblage dans lib/server/database.ts", () => {
  // `runMigrations` tourne contre un vrai MySQL et n'est pas exécutable ici :
  // ce qui est vérifié est que la porte d'entrée du schéma passe bien par les
  // deux garanties ci-dessus, et non par une promesse mémorisée à la main.
  const source = readFileSync(join(__dirname, "..", "..", "..", "lib", "server", "database.ts"), "utf8");

  it("joue les migrations à travers la porte et le verrou", () => {
    expect(source).toMatch(/migrationGate\.run\(\(\) => withMigrationLock\(db, \(\) => runMigrations\(db\)\)\)/);
  });

  it("ne mémorise plus la promesse des migrations à la main", () => {
    expect(source).not.toMatch(/migrationPromise/);
  });
});
