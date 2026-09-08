import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  FALLBACK_BUREAU,
  createBureauMember,
  deleteBureauMember,
  listBureauMembers,
  updateBureauMember,
} from "@/lib/server/bureau-service";
import { clearCache } from "@/lib/server/cache";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("bureau-service", () => {
  // La lecture est mutualisée (`showcase-cache`) : sans cette remise à zéro, le
  // premier cas resservirait sa réponse à tous les suivants.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  describe("listBureauMembers", () => {
    it("returns rows from the database", async () => {
      const rows = [
        { id: 1, name: "Léo", role: "Président", initials: "LP", color: "rgb(1,2,3)" },
      ];
      await mockDb(jest.fn().mockResolvedValue([rows]));

      const result = await listBureauMembers();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 1, name: "Léo", role: "Président", initials: "LP", color: "rgb(1,2,3)" });
    });

    it("returns the fallback when the table is empty", async () => {
      await mockDb(jest.fn().mockResolvedValue([[]]));
      const result = await listBureauMembers();
      expect(result).toBe(FALLBACK_BUREAU);
    });

    it("returns the fallback when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("down"));
      const result = await listBureauMembers();
      expect(result).toBe(FALLBACK_BUREAU);
    });
  });

  describe("createBureauMember", () => {
    it("inserts and returns the new member", async () => {
      const execute = jest.fn().mockResolvedValue([{ insertId: 42 }]);
      await mockDb(execute);

      const member = await createBureauMember({ name: "Sophie Martin", role: "Secrétaire", color: "rgb(9,9,9)" });
      expect(member).toEqual({ id: 42, name: "Sophie Martin", role: "Secrétaire", initials: "SM", color: "rgb(9,9,9)" });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid input before touching the database", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(createBureauMember({ name: "", role: "Role" })).rejects.toThrow("NAME_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("updateBureauMember", () => {
    it("updates and returns the member", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);

      const member = await updateBureauMember(7, { name: "Jérôme Dubois", role: "Arbitre", initials: "JD", color: "rgb(1,1,1)" });
      expect(member).toEqual({ id: 7, name: "Jérôme Dubois", role: "Arbitre", initials: "JD", color: "rgb(1,1,1)" });
    });

    it("throws NOT_FOUND when no row matches", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(updateBureauMember(999, { name: "X", role: "Y" })).rejects.toThrow("BUREAU_MEMBER_NOT_FOUND");
    });

    it("rejects invalid input", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(updateBureauMember(1, { name: "X", role: "" })).rejects.toThrow("ROLE_REQUIRED");
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteBureauMember", () => {
    it("deletes an existing member", async () => {
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      await mockDb(execute);
      await expect(deleteBureauMember(3)).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE"), [3]);
    });

    it("throws NOT_FOUND when nothing is deleted", async () => {
      await mockDb(jest.fn().mockResolvedValue([{ affectedRows: 0 }]));
      await expect(deleteBureauMember(999)).rejects.toThrow("BUREAU_MEMBER_NOT_FOUND");
    });
  });
});

/**
 * `/association` est rendue à chaque visite (elle lit la session) et n'est pas
 * une route API : aucun plafond de débit ne peut la protéger, la mutualisation
 * est le seul garde-fou disponible. Le bureau était pourtant relu à chaque
 * arrivée, seul de la page à l'être — ses quatre voisines passaient déjà par le
 * cache de vitrine.
 */
describe("bureau-service — mutualisation de la lecture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  const rows = [
    { id: 1, name: "Léo", role: "Président", initials: "LP", color: "rgb(1,2,3)" },
  ];

  it("ne lit la base qu'une fois pour cent visiteurs simultanés", async () => {
    const execute = jest.fn().mockResolvedValue([rows]);
    await mockDb(execute);

    const results = await Promise.all(
      Array.from({ length: 100 }, () => listBureauMembers()),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result).toHaveLength(1);
  });

  it("resert la liste en cache aux visites suivantes", async () => {
    const execute = jest.fn().mockResolvedValue([rows]);
    await mockDb(execute);

    await listBureauMembers();
    await listBureauMembers();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("ne met pas un échec en cache", async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error("DOWN"))
      .mockResolvedValue([rows]);
    await mockDb(execute);

    expect(await listBureauMembers()).toBe(FALLBACK_BUREAU);
    expect(await listBureauMembers()).toHaveLength(1);
  });

  it.each([
    ["createBureauMember", () => createBureauMember({ name: "A", role: "R", initials: "AB", color: "rgb(1,2,3)" })],
    ["updateBureauMember", () => updateBureauMember(1, { name: "A", role: "R", initials: "AB", color: "rgb(1,2,3)" })],
    ["deleteBureauMember", () => deleteBureauMember(1)],
  ])("oublie la liste après %s", async (_name, write) => {
    const execute = jest.fn().mockImplementation(async (sql: string) =>
      sql.trim().startsWith("SELECT") ? [rows] : [{ insertId: 9, affectedRows: 1 }],
    );
    await mockDb(execute);

    await listBureauMembers();
    execute.mockClear();

    // Le staff vient d'écrire : la vitrine doit le montrer sans attendre la fin
    // de la fenêtre de cache.
    await write();
    await listBureauMembers();

    expect(execute.mock.calls.some(([sql]) => String(sql).trim().startsWith("SELECT"))).toBe(true);
  });
});
