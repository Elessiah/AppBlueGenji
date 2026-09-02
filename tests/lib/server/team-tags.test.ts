import { describe, expect, it, jest } from "@jest/globals";
import {
  assertTeamTagAvailable,
  isTeamTagConflict,
  mapTeamTagConflict,
  resolveTeamTag,
} from "@/lib/server/team-tags";

/**
 * Unicité du sigle côté serveur.
 *
 * Deux contrôles qui ne font pas double emploi : le `SELECT` préalable, qui
 * donne le refus lisible du cas courant, et la traduction de la violation
 * d'index, seul juge quand deux créations simultanées passent toutes deux le
 * `SELECT`. Les deux doivent rendre **le même code**, faute de quoi la course
 * répondrait autre chose que le cas courant.
 */

function executor(rows: unknown[]) {
  const execute = jest.fn<(sql: string, params?: unknown[]) => Promise<[unknown[], unknown]>>();
  execute.mockResolvedValue([rows, []]);
  // Le module n'attend qu'un `execute` : un pool comme une connexion de
  // transaction le fournissent.
  return { db: { execute } as never, execute };
}

function dupError(indexName: string) {
  return Object.assign(new Error(`Duplicate entry 'BG' for key '${indexName}'`), {
    code: "ER_DUP_ENTRY",
    sqlMessage: `Duplicate entry 'BG' for key '${indexName}'`,
  });
}

describe("resolveTeamTag", () => {
  it("rend la forme canonique d'une saisie valide", () => {
    expect(resolveTeamTag("  bg ")).toBe("BG");
  });

  it("rend null pour une absence de sigle", () => {
    expect(resolveTeamTag(null)).toBeNull();
    expect(resolveTeamTag("")).toBeNull();
  });

  it.each([
    ["B", "TEAM_TAG_TOO_SHORT"],
    ["ABCDE", "TEAM_TAG_TOO_LONG"],
    ["B G", "TEAM_TAG_NOT_ALPHANUMERIC"],
  ])("lève le code de refus du module pur pour %s", (raw, code) => {
    expect(() => resolveTeamTag(raw)).toThrow(code);
  });
});

describe("assertTeamTagAvailable", () => {
  it("ne requête rien quand il n'y a pas de sigle", async () => {
    const { db, execute } = executor([]);
    await expect(assertTeamTagAvailable(db, null)).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("laisse passer un sigle libre", async () => {
    const { db, execute } = executor([]);
    await expect(assertTeamTagAvailable(db, "BG")).resolves.toBeUndefined();
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SELECT id FROM bg_teams WHERE tag = \?/);
    expect(params).toEqual(["BG"]);
  });

  it("refuse un sigle déjà porté", async () => {
    const { db } = executor([{ id: 7 }]);
    await expect(assertTeamTagAvailable(db, "BG")).rejects.toThrow("TEAM_TAG_ALREADY_USED");
  });

  it("exclut l'équipe elle-même en édition — sans quoi elle se bloquerait", async () => {
    const { db, execute } = executor([]);
    await assertTeamTagAvailable(db, "BG", 12);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/id <> \?/);
    expect(params).toEqual(["BG", 12]);
  });

  it("ne pose pas d'exclusion quand aucune équipe n'est à épargner", async () => {
    const { db, execute } = executor([]);
    await assertTeamTagAvailable(db, "BG");
    const [sql] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/id <> \?/);
  });
});

describe("isTeamTagConflict", () => {
  it("reconnaît la violation de l'index des sigles", () => {
    expect(isTeamTagConflict(dupError("bg_teams.uniq_bg_teams_tag"))).toBe(true);
  });

  it("ignore la violation de l'unicité du **nom** — deux uniques sur la table", () => {
    expect(isTeamTagConflict(dupError("bg_teams.name"))).toBe(false);
  });

  it("ignore l'unicité de l'entrée solo", () => {
    expect(isTeamTagConflict(dupError("bg_teams.uniq_bg_teams_solo_user"))).toBe(false);
  });

  it("ignore une erreur qui n'est pas un doublon", () => {
    expect(isTeamTagConflict(new Error("ECONNREFUSED"))).toBe(false);
    expect(isTeamTagConflict(null)).toBe(false);
    expect(isTeamTagConflict(undefined)).toBe(false);
  });

  it("se contente du message quand `sqlMessage` manque", () => {
    const error = Object.assign(new Error("Duplicate entry 'BG' for key 'uniq_bg_teams_tag'"), {
      code: "ER_DUP_ENTRY",
    });
    expect(isTeamTagConflict(error)).toBe(true);
  });
});

describe("mapTeamTagConflict", () => {
  it("rend le résultat de l'écriture quand tout va bien", async () => {
    await expect(mapTeamTagConflict(async () => 42)).resolves.toBe(42);
  });

  it("traduit la course perdue dans le même code que le contrôle préalable", async () => {
    await expect(
      mapTeamTagConflict(async () => {
        throw dupError("bg_teams.uniq_bg_teams_tag");
      }),
    ).rejects.toThrow("TEAM_TAG_ALREADY_USED");
  });

  it("laisse passer la collision de nom telle quelle", async () => {
    await expect(
      mapTeamTagConflict(async () => {
        throw dupError("bg_teams.name");
      }),
    ).rejects.toThrow(/Duplicate entry/);
  });

  it("ne masque aucune autre erreur", async () => {
    await expect(
      mapTeamTagConflict(async () => {
        throw new Error("ER_LOCK_WAIT_TIMEOUT");
      }),
    ).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");
  });
});
