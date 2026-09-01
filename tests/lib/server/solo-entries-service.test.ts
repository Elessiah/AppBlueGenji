import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import {
  ensureSoloEntry,
  findSoloEntry,
  findSoloEntryUser,
  loadSoloUserIds,
  syncSoloEntryIdentity,
} from "@/lib/server/solo-entries-service";
import { getDatabase } from "@/lib/server/database";

jest.mock("@/lib/server/database");

type ExecuteMock = jest.Mock;

function fakeConnection(execute: ExecuteMock): PoolConnection {
  return { execute } as unknown as PoolConnection;
}

function duplicateName(): Error {
  const error = new Error("Duplicate entry") as Error & { code: string };
  error.code = "ER_DUP_ENTRY";
  return error;
}

const USER = [[{ pseudo: "ShadowNinja", avatar_url: "/u/1.png" }], []];
const NO_ROW = [[], []];

describe("ensureSoloEntry", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("crée l'entrée solo au nom du joueur, sans membre ni caractère fantôme", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(USER as never) // identité du compte
      .mockResolvedValueOnce(NO_ROW as never) // aucune entrée existante
      .mockResolvedValueOnce([{ insertId: 77 }] as never);

    await expect(ensureSoloEntry(fakeConnection(execute), 1)).resolves.toBe(77);

    const [sql, params] = execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO bg_teams .*solo_user_id/s);
    expect(sql).toMatch(/VALUES \(\?, \?, NULL, 0, \?\)/);
    expect(params).toEqual(["ShadowNinja", "/u/1.png", 1]);
  });

  it("réutilise l'entrée existante et resynchronise son identité", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(USER as never)
      .mockResolvedValueOnce([[{ id: 55 }], []] as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);

    await expect(ensureSoloEntry(fakeConnection(execute), 1)).resolves.toBe(55);

    const [sql, params] = execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_teams SET name = \?, logo_url = \?/);
    expect(params).toEqual(["ShadowNinja", "/u/1.png", 55]);
    // Une seule entrée solo par joueur : jamais de seconde création.
    expect(execute.mock.calls.some(([query]) => String(query).includes("INSERT"))).toBe(false);
  });

  it("bascule sur le nom suffixé quand le pseudo est déjà pris par une équipe", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(USER as never)
      .mockResolvedValueOnce(NO_ROW as never)
      .mockRejectedValueOnce(duplicateName() as never) // « ShadowNinja » est pris
      .mockResolvedValueOnce(NO_ROW as never) // pas de course concurrente
      .mockResolvedValueOnce([{ insertId: 91 }] as never);

    await expect(ensureSoloEntry(fakeConnection(execute), 4)).resolves.toBe(91);

    const [, params] = execute.mock.calls[4] as [string, unknown[]];
    expect(params).toEqual(["ShadowNinja #4", "/u/1.png", 4]);
  });

  it("récupère l'entrée gagnante en cas d'inscription concurrente", async () => {
    // Deux inscriptions simultanées : la seconde bute sur l'unicité de
    // `solo_user_id` et doit adopter l'entrée déjà créée.
    const execute = jest
      .fn()
      .mockResolvedValueOnce(USER as never)
      .mockResolvedValueOnce(NO_ROW as never)
      .mockRejectedValueOnce(duplicateName() as never)
      .mockResolvedValueOnce([[{ id: 33 }], []] as never);

    await expect(ensureSoloEntry(fakeConnection(execute), 4)).resolves.toBe(33);
  });

  it("remonte une erreur SQL qui n'est pas un doublon", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(USER as never)
      .mockResolvedValueOnce(NO_ROW as never)
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK") as never);

    await expect(ensureSoloEntry(fakeConnection(execute), 4)).rejects.toThrow("ER_LOCK_DEADLOCK");
  });

  it("échoue si tous les noms candidats sont pris", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(USER as never)
      .mockResolvedValueOnce(NO_ROW as never)
      .mockRejectedValueOnce(duplicateName() as never)
      .mockResolvedValueOnce(NO_ROW as never)
      .mockRejectedValueOnce(duplicateName() as never)
      .mockResolvedValueOnce(NO_ROW as never)
      .mockRejectedValueOnce(duplicateName() as never)
      .mockResolvedValueOnce(NO_ROW as never);

    await expect(ensureSoloEntry(fakeConnection(execute), 4)).rejects.toThrow(
      "SOLO_ENTRY_NAME_UNAVAILABLE",
    );
  });

  it("refuse un compte inconnu", async () => {
    const execute = jest.fn().mockResolvedValueOnce(NO_ROW as never);
    await expect(ensureSoloEntry(fakeConnection(execute), 404)).rejects.toThrow("USER_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("findSoloEntry", () => {
  it("renvoie null quand le joueur n'a jamais joué en individuel", async () => {
    const execute = jest.fn().mockResolvedValue(NO_ROW as never);
    await expect(findSoloEntry(fakeConnection(execute), 8)).resolves.toBeNull();
  });

  it("renvoie l'identifiant de l'entrée", async () => {
    const execute = jest.fn().mockResolvedValue([[{ id: 12 }], []] as never);
    await expect(findSoloEntry(fakeConnection(execute), 8)).resolves.toBe(12);
  });
});

describe("syncSoloEntryIdentity", () => {
  beforeEach(() => jest.clearAllMocks());

  async function mockPool(execute: ExecuteMock) {
    const { getDatabase } = await import("@/lib/server/database");
    const release = jest.fn();
    (getDatabase as jest.Mock).mockResolvedValue({
      getConnection: jest.fn(async () => ({ execute, release })),
    } as never);
    return release;
  }

  it("ne touche à rien si le joueur n'a pas d'entrée solo", async () => {
    const execute = jest.fn().mockResolvedValue(NO_ROW as never);
    const release = await mockPool(execute);

    await syncSoloEntryIdentity(3);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalled();
  });

  it("recopie pseudo et avatar sur l'entrée", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 5 }], []] as never)
      .mockResolvedValueOnce([[{ pseudo: "Nova", avatar_url: null }], []] as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);
    await mockPool(execute);

    await syncSoloEntryIdentity(3);

    const [sql, params] = execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_teams SET name = \?, logo_url = \?/);
    expect(params).toEqual(["Nova", null, 5]);
  });

  it("laisse le nom en place si le nouveau pseudo est déjà pris", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ id: 5 }], []] as never)
      .mockResolvedValueOnce([[{ pseudo: "Nova", avatar_url: null }], []] as never)
      .mockRejectedValueOnce(duplicateName() as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);
    await mockPool(execute);

    // Un renommage de profil ne doit pas échouer à cause de l'entrée solo.
    await expect(syncSoloEntryIdentity(3)).resolves.toBeUndefined();
    const [, params] = execute.mock.calls[3] as [string, unknown[]];
    expect(params).toEqual(["Nova #3", null, 5]);
  });
});

describe("loadSoloUserIds", () => {
  it("n'interroge pas la base sans engagé", async () => {
    const execute = jest.fn();
    await expect(loadSoloUserIds(fakeConnection(execute), [])).resolves.toEqual({});
    expect(execute).not.toHaveBeenCalled();
  });

  it("associe chaque entrée solo à son joueur", async () => {
    const execute = jest.fn().mockResolvedValue([
      [
        { id: 7, solo_user_id: 70 },
        { id: 9, solo_user_id: 90 },
      ],
      [],
    ] as never);

    await expect(loadSoloUserIds(fakeConnection(execute), [7, 8, 9])).resolves.toEqual({
      7: 70,
      9: 90,
    });

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/solo_user_id IS NOT NULL/);
    expect(params).toEqual([7, 8, 9]);
  });
});

/**
 * Le sens inverse de `findSoloEntry` : d'un identifiant d'engagé vers le compte
 * qu'il représente. Sert à `/equipes/[id]`, où un lien parfaitement valide peut
 * désigner une entrée solo — laquelle n'a pas de fiche d'équipe.
 */
describe("findSoloEntryUser", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  async function withRows(rows: unknown[]) {
    const execute = jest.fn().mockResolvedValue([rows, []] as never);
    (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
    return execute;
  }

  it("rend le compte derrière une entrée solo", async () => {
    const execute = await withRows([{ solo_user_id: 17372 }]);

    await expect(findSoloEntryUser(15245)).resolves.toBe(17372);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SELECT solo_user_id FROM bg_teams WHERE id = \? LIMIT 1/);
    expect(params).toEqual([15245]);
  });

  it("rend null pour une vraie équipe", async () => {
    // `solo_user_id IS NULL` : la ligne existe, mais c'est une équipe — sa fiche
    // s'ouvre normalement, il n'y a rien à rediriger.
    await withRows([{ solo_user_id: null }]);
    await expect(findSoloEntryUser(641)).resolves.toBeNull();
  });

  it("rend null pour un identifiant inconnu", async () => {
    await withRows([]);
    await expect(findSoloEntryUser(999999)).resolves.toBeNull();
  });

  it("normalise un identifiant rendu en chaîne par le pilote", async () => {
    // `BIGINT` peut remonter en chaîne selon la configuration mysql2 : un
    // `/joueurs/"77"` construirait la même URL, mais le typage mentirait.
    await withRows([{ solo_user_id: "77" }]);
    await expect(findSoloEntryUser(15245)).resolves.toBe(77);
  });
});
