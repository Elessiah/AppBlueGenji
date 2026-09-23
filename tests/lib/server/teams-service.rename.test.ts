import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { updateTeamMeta } from "@/lib/server/teams-service";
import { assertTeamNameAvailable, isTeamNameConflict } from "@/lib/server/team-tags";
import { getDatabase } from "@/lib/server/database";

/**
 * Renommer une équipe : mêmes bornes qu'à la création, unicité dite en
 * français.
 *
 * Le renommage ne contrôlait rien. Un nom vide s'enregistrait ; un nom trop
 * long ou déjà pris partait en erreur MySQL brute jusqu'à la notification.
 */

const owner = [[{ roles_json: JSON.stringify(["OWNER"]) }]];

function dupError(key: string) {
  const message = `Duplicate entry 'X' for key '${key}'`;
  return Object.assign(new Error(message), { code: "ER_DUP_ENTRY", sqlMessage: message });
}

let execute: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  execute = jest.fn();
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
});

const wrote = () => execute.mock.calls.some(([sql]) => /UPDATE bg_teams/.test(String(sql)));

describe("updateTeamMeta — nom", () => {
  it.each([
    ["vide", ""],
    ["fait d'espaces", "   "],
    ["de deux caractères", "ab"],
    ["de 61 caractères", "a".repeat(61)],
  ])("refuse un nom %s sans rien écrire", async (_label, name) => {
    execute.mockResolvedValueOnce(owner as never);

    await expect(updateTeamMeta(1, 7, { name })).rejects.toThrow("INVALID_TEAM_NAME");
    expect(wrote()).toBe(false);
  });

  it("refuse un nom déjà porté par une autre équipe, avant d'écrire", async () => {
    execute
      .mockResolvedValueOnce(owner as never)
      .mockResolvedValueOnce([[{ id: 9 }]] as never); // nom pris

    await expect(updateTeamMeta(1, 7, { name: "Dragon Squad" })).rejects.toThrow("TEAM_NAME_ALREADY_USED");
    expect(wrote()).toBe(false);
  });

  it("laisse l'équipe garder son propre nom (casse comprise)", async () => {
    execute
      .mockResolvedValueOnce(owner as never)
      .mockResolvedValueOnce([[]] as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);

    await updateTeamMeta(1, 7, { name: "  Rolex  " });

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/WHERE name = \? AND id <> \?/);
    expect(params).toEqual(["Rolex", 7]);
    const [, updateParams] = execute.mock.calls[2] as [string, unknown[]];
    // Le nom écrit est rogné.
    expect(updateParams).toEqual(["Rolex", 7]);
  });

  it("traduit la course entre deux renommages vers le même nom", async () => {
    execute
      .mockResolvedValueOnce(owner as never)
      .mockResolvedValueOnce([[]] as never)
      .mockRejectedValueOnce(dupError("bg_teams.name") as never);

    await expect(updateTeamMeta(1, 7, { name: "Dragon Squad" })).rejects.toThrow("TEAM_NAME_ALREADY_USED");
  });

  it("garde la traduction du sigle quand c'est lui qui entre en collision", async () => {
    execute
      .mockResolvedValueOnce(owner as never)
      .mockResolvedValueOnce([[]] as never) // tag libre au SELECT
      .mockRejectedValueOnce(dupError("uniq_bg_teams_tag") as never);

    await expect(updateTeamMeta(1, 7, { tag: "BG" })).rejects.toThrow("TEAM_TAG_ALREADY_USED");
  });

  it("vérifie les droits avant la forme : un intrus n'apprend rien du nom", async () => {
    execute.mockResolvedValueOnce([[]] as never);
    await expect(updateTeamMeta(99, 7, { name: "" })).rejects.toThrow("FORBIDDEN");
  });

  it("ne touche pas au nom quand le patch ne le porte pas", async () => {
    execute
      .mockResolvedValueOnce(owner as never)
      .mockResolvedValueOnce([{ affectedRows: 1 }] as never);

    await updateTeamMeta(1, 7, { description: "Nouvelle description" });

    const sqls = execute.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => /WHERE name = \?/.test(sql))).toBe(false);
    expect(sqls.at(-1)).toMatch(/UPDATE bg_teams SET description = \?/);
  });
});

describe("assertTeamNameAvailable", () => {
  it("exclut l'équipe elle-même quand on le lui demande", async () => {
    const exec = jest.fn(async () => [[], []]);
    await assertTeamNameAvailable({ execute: exec } as never, "Rolex", 7);
    expect(exec).toHaveBeenCalledWith(expect.stringMatching(/AND id <> \?/), ["Rolex", 7]);
  });

  it("interroge sans exclusion à la création", async () => {
    const exec = jest.fn(async () => [[], []]);
    await assertTeamNameAvailable({ execute: exec } as never, "Rolex");
    expect(exec).toHaveBeenCalledWith(expect.not.stringMatching(/id <>/), ["Rolex"]);
  });

  it("lève TEAM_NAME_ALREADY_USED sur un nom pris", async () => {
    const exec = jest.fn(async () => [[{ id: 3 }], []]);
    await expect(assertTeamNameAvailable({ execute: exec } as never, "Rolex", 7)).rejects.toThrow(
      "TEAM_NAME_ALREADY_USED",
    );
  });
});

describe("isTeamNameConflict", () => {
  it("reconnaît la violation de l'unicité du nom", () => {
    expect(isTeamNameConflict(dupError("bg_teams.name"))).toBe(true);
    expect(isTeamNameConflict(dupError("name"))).toBe(true);
  });

  it("ne confond ni le sigle ni l'entrée solo avec le nom", () => {
    expect(isTeamNameConflict(dupError("bg_teams.uniq_bg_teams_tag"))).toBe(false);
    expect(isTeamNameConflict(dupError("bg_teams.uniq_bg_teams_solo_user"))).toBe(false);
  });

  it("ignore toute autre erreur", () => {
    expect(isTeamNameConflict(new Error("boom"))).toBe(false);
    expect(isTeamNameConflict(null)).toBe(false);
  });
});
