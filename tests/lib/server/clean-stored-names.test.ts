import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cleanStoredNames } from "@/lib/server/database/data-migrations";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * `cleanStoredNames` retire une fois, par `withoutInvisibles`, les invisibles et
 * commandes de direction des noms enregistrés avant le nettoyage à l'écriture
 * (`UNTRUSTED_NAMES.md`) : équipes, pseudos, tournois. Sans NFKC : un nom
 * stylisé n'est jamais renommé.
 */

/** Erreur mysql2 minimale. */
function mysqlError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

type Rows = Record<string, { id: number; name: string | null }[]>;

let logSpy: jest.SpiedFunction<typeof console.log>;
let errorSpy: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Base simulée : chaque table rend ses lignes ; `updateReply` décide de chaque écriture. */
function database(rows: Rows, updateReply: (params: unknown[]) => unknown = () => [{ affectedRows: 1 }, undefined]) {
  const execute = jest.fn<SqlQuery>(async (sql, params) => {
    const select = /^SELECT id, \w+ AS name FROM (\w+)$/.exec(sql);
    if (select) return [rows[select[1]] ?? [], undefined];
    if (sql.startsWith("UPDATE")) return updateReply(params as unknown[]);
    throw new Error(`requête inattendue : ${sql}`);
  });
  return { execute, pool: fakePool({ execute }) };
}

function updates(execute: jest.Mock<SqlQuery>): { sql: string; params: unknown }[] {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE")).map(([sql, params]) => ({ sql, params }));
}

function logged(): string {
  return logSpy.mock.calls.map(([line]) => String(line)).join("\n");
}

describe("cleanStoredNames", () => {
  it("réécrit un nom à commande de direction ou à invisible, dans les trois tables", async () => {
    const { execute, pool } = database({
      bg_teams: [{ id: 1, name: "Dragon\u202E Squad" }],
      bg_users: [{ id: 2, name: "Adm\u200Bin" }],
      bg_tournaments: [{ id: 3, name: "  Coupe\u2060   d'hiver " }],
    });

    await cleanStoredNames(pool);

    expect(updates(execute)).toEqual([
      { sql: "UPDATE bg_teams SET name = ?, updated_at = updated_at WHERE id = ? AND name = ?", params: ["Dragon Squad", 1, "Dragon\u202E Squad"] },
      { sql: "UPDATE bg_users SET pseudo = ?, updated_at = updated_at WHERE id = ? AND pseudo = ?", params: ["Admin", 2, "Adm\u200Bin"] },
      {
        sql: "UPDATE bg_tournaments SET name = ?, updated_at = updated_at WHERE id = ? AND name = ?",
        params: ["Coupe   d'hiver", 3, "  Coupe\u2060   d'hiver "],
      },
    ]);
    // Le journal compte, il ne nomme personne (`RGPD_LOGS_AND_VISITS.md`).
    expect(logged()).toContain("bg_users.pseudo : 1 nom(s) réécrit(s)");
    expect(logged()).not.toContain("Admin");
    expect(logged()).not.toContain("Dragon");
  });

  it("garde updated_at : un nettoyage ne redate ni tournoi ni équipe (tendances du classement)", async () => {
    const { execute, pool } = database({
      bg_teams: [{ id: 1, name: "A​b" }],
      bg_users: [{ id: 2, name: "C​d" }],
      bg_tournaments: [{ id: 3, name: "E​f" }],
    });

    await cleanStoredNames(pool);

    const sent = updates(execute);
    expect(sent).toHaveLength(3);
    for (const { sql } of sent) expect(sql).toContain(", updated_at = updated_at WHERE");
  });

  it("ne touche ni n'annonce rien quand les noms sont déjà propres (accents et emoji compris)", async () => {
    const { execute, pool } = database({
      bg_teams: [{ id: 1, name: "Équipe 👨\u200D👩\u200D👧" }],
      bg_users: [
        { id: 2, name: "Zoé" },
        { id: 3, name: null },
      ],
      bg_tournaments: [],
    });

    await cleanStoredNames(pool);

    expect(updates(execute)).toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("laisse octet pour octet un nom stylisé (exposant, fraction, pleine chasse, espace fine)", async () => {
    const { execute, pool } = database({
      bg_teams: [
        { id: 1, name: "Team²" },
        { id: 2, name: "Ｄｒａｇｏｎ  Squad" },
      ],
      bg_users: [{ id: 3, name: "½ Lune" }],
      bg_tournaments: [{ id: 4, name: "Coupe\u202F2026 ™" }],
    });

    await cleanStoredNames(pool);

    expect(updates(execute)).toEqual([]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("ne retire que les invisibles d'un nom stylisé, sans le normaliser", async () => {
    const { execute, pool } = database({ bg_teams: [{ id: 1, name: "\u202ETeam²\u200B Ｘ" }] });

    await cleanStoredNames(pool);

    expect(updates(execute)).toEqual([
      { sql: "UPDATE bg_teams SET name = ?, updated_at = updated_at WHERE id = ? AND name = ?", params: ["Team² Ｘ", 1, "\u202ETeam²\u200B Ｘ"] },
    ]);
  });

  it("laisse un nom qui ne garderait rien de visible", async () => {
    const { execute, pool } = database({ bg_teams: [{ id: 1, name: "\u200B\u2060" }] });

    await cleanStoredNames(pool);

    expect(updates(execute)).toEqual([]);
    expect(logged()).toContain("bg_teams.name : 0 nom(s) réécrit(s) sans caractère invisible, 1 laissé(s)");
  });

  it("laisse un sosie dont la forme propre est prise (UNIQUE), et poursuit", async () => {
    const { execute, pool } = database(
      {
        bg_users: [
          { id: 2, name: "Adm\u200Bin" },
          { id: 4, name: "Lé\u202Ea" },
        ],
      },
      (params) => {
        if (params[0] === "Admin") throw mysqlError("ER_DUP_ENTRY");
        return [{ affectedRows: 1 }, undefined];
      },
    );

    await cleanStoredNames(pool);

    expect(updates(execute)).toHaveLength(2);
    expect(logged()).toContain("bg_users.pseudo : 1 nom(s) réécrit(s) sans caractère invisible, 1 laissé(s)");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ne compte pas une ligne renommée entre la lecture et l'écriture", async () => {
    const { pool } = database({ bg_teams: [{ id: 1, name: "A\u200Bb" }] }, () => [{ affectedRows: 0 }, undefined]);

    await cleanStoredNames(pool);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("dit une table illisible sans faire tomber le démarrage, et passe à la suivante", async () => {
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("FROM bg_teams")) throw mysqlError("ER_LOCK_WAIT_TIMEOUT");
      if (sql.startsWith("SELECT")) return [[{ id: 2, name: "B\u200Bob" }], undefined];
      return [{ affectedRows: 1 }, undefined];
    });

    await expect(cleanStoredNames(fakePool({ execute }))).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("nettoyage des noms");
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"))).toHaveLength(2);
  });
});
