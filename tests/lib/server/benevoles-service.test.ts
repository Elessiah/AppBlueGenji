import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  createBenevole,
  deleteBenevole,
  listBenevoles,
  updateBenevole,
} from "@/lib/server/benevoles-service";
import { clearCache } from "@/lib/server/cache";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

const ROW = {
  id: 1,
  first_name: "Léa",
  pseudo: "lea",
  last_name: "Martin",
  category: "Arbitrage",
  photo_url: null,
  joined_at: "2025-01-05",
};

const INPUT = {
  firstName: "Léa",
  lastName: "Martin",
  pseudo: "lea",
  category: "Arbitrage",
  photoUrl: null,
  joinedAt: "2025-01-05",
};

/** Répond aux SELECT par `rows`, aux écritures par un en-tête de résultat. */
function db(rows: unknown[] = [ROW]): jest.Mock {
  return jest.fn().mockImplementation(async (sql: string) => {
    const query = String(sql).trim();
    if (!query.startsWith("SELECT")) return [{ insertId: 9, affectedRows: 1 }];
    // `resolveCategoryOrder` interroge aussi la table : elle attend une colonne
    // d'ordre, pas une ligne de bénévole. On distingue sur les colonnes
    // **sélectionnées** — « category_order » figure aussi dans le `ORDER BY` de
    // la liste, et le confondre y renvoyait une ligne que `fromRow` fait
    // exploser.
    if (query.startsWith("SELECT category_order") || query.includes("MAX(category_order)")) {
      return [[{ category_order: 10, next: 10 }]];
    }
    return [rows];
  });
}

/**
 * `/benevoles` est une page de vitrine rendue à chaque visite (elle lit la
 * session) et n'est pas une route API : aucun plafond de débit ne peut la
 * protéger, la mutualisation est le seul garde-fou disponible. Cette liste-là
 * était pourtant relue à chaque arrivée.
 */
describe("benevoles-service — mutualisation de la lecture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  it("rend les lignes de la base", async () => {
    await mockDb(db());

    const result = await listBenevoles();

    expect(result).toEqual([
      {
        id: 1,
        firstName: "Léa",
        pseudo: "lea",
        lastName: "Martin",
        category: "Arbitrage",
        photoUrl: null,
        joinedAt: "2025-01-05",
      },
    ]);
  });

  it("ne lit la base qu'une fois pour cent visiteurs simultanés", async () => {
    const execute = db();
    await mockDb(execute);

    await Promise.all(Array.from({ length: 100 }, () => listBenevoles()));

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resert la liste en cache aux visites suivantes", async () => {
    const execute = db();
    await mockDb(execute);

    await listBenevoles();
    await listBenevoles();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rend une liste vide quand la base est injoignable, sans la mettre en cache", async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error("DOWN"))
      .mockImplementation(async () => [[ROW]]);
    await mockDb(execute);

    expect(await listBenevoles()).toEqual([]);
    expect(await listBenevoles()).toHaveLength(1);
  });

  it.each([
    ["createBenevole", () => createBenevole(INPUT)],
    ["updateBenevole", () => updateBenevole(1, INPUT)],
    ["deleteBenevole", () => deleteBenevole(1)],
  ])("oublie la liste après %s", async (_name, write) => {
    const execute = db();
    await mockDb(execute);

    await listBenevoles();
    execute.mockClear();

    // Le staff vient d'écrire : la vitrine doit le montrer sans attendre la fin
    // de la fenêtre de cache.
    await write();
    await listBenevoles();

    const reread = execute.mock.calls.some(([sql]) =>
      String(sql).trim().startsWith("SELECT id, first_name"),
    );
    expect(reread).toBe(true);
  });
});
