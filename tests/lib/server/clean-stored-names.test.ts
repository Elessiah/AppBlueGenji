import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cleanStoredNames } from "@/lib/server/database/data-migrations";
import { CLEAN_STORED_NAMES_MARKER } from "@/lib/server/database/data-migrations";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

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

/**
 * Base simulée : chaque table rend ses lignes ; `updateReply` décide de chaque
 * écriture ; `marked` dit si la passe a déjà été menée à bout (marqueur posé).
 * Le pool et sa connexion de passe partagent le même `execute`.
 */
function database(
  rows: Rows,
  updateReply: (params: unknown[]) => unknown = () => [{ affectedRows: 1 }, undefined],
  marked = false,
) {
  const release = jest.fn<() => void>();
  const execute = jest.fn<SqlQuery>(async (sql, params) => {
    if (sql.startsWith("SELECT 1 FROM bg_settings")) return [marked ? [{ 1: 1 }] : [], undefined];
    if (sql.startsWith("INSERT INTO bg_settings") || sql.startsWith("SET SESSION")) return [{ affectedRows: 1 }, undefined];
    const select = /^SELECT id, \w+ AS name FROM (\w+)$/.exec(sql);
    if (select) return [rows[select[1]] ?? [], undefined];
    if (sql.startsWith("UPDATE")) return updateReply(params as unknown[]);
    throw new Error(`requête inattendue : ${sql}`);
  });
  const getConnection = jest.fn(async () => fakeConnection({ execute, release }));
  return { execute, release, pool: fakePool({ execute, getConnection }) };
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
      { sql: "UPDATE bg_teams SET name = ?, updated_at = updated_at WHERE id = ? AND name COLLATE utf8mb4_bin = ?", params: ["Dragon Squad", 1, "Dragon\u202E Squad"] },
      { sql: "UPDATE bg_users SET pseudo = ?, updated_at = updated_at WHERE id = ? AND pseudo COLLATE utf8mb4_bin = ?", params: ["Admin", 2, "Adm\u200Bin"] },
      {
        sql: "UPDATE bg_tournaments SET name = ?, updated_at = updated_at WHERE id = ? AND name COLLATE utf8mb4_bin = ?",
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
      { sql: "UPDATE bg_teams SET name = ?, updated_at = updated_at WHERE id = ? AND name COLLATE utf8mb4_bin = ?", params: ["Team² Ｘ", 1, "\u202ETeam²\u200B Ｘ"] },
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

  it("compare l'ancien nom octet à octet : un renommage par la casse n'est pas écrasé", async () => {
    // La collation des colonnes (`_ai_ci`) ignore casse, accents et invisibles :
    // sans `utf8mb4_bin`, « TEAM » renommé entre-temps égalerait « Te​am ».
    const { execute, pool } = database({
      bg_teams: [{ id: 1, name: "Te​am" }],
      bg_users: [{ id: 2, name: "Bo​b" }],
      bg_tournaments: [{ id: 3, name: "Cu​p" }],
    });

    await cleanStoredNames(pool);

    const guards = updates(execute).map(({ sql }) => /WHERE id = \? AND (\w+)( COLLATE \w+)? = \?$/.exec(sql));
    expect(guards.map((match) => match?.[2])).toEqual([" COLLATE utf8mb4_bin", " COLLATE utf8mb4_bin", " COLLATE utf8mb4_bin"]);
  });

  it("dit une table illisible sans faire tomber le démarrage, passe à la suivante, et ne pose pas le marqueur", async () => {
    const release = jest.fn<() => void>();
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT 1 FROM bg_settings")) return [[], undefined];
      if (sql.includes("FROM bg_teams")) throw mysqlError("ER_LOCK_WAIT_TIMEOUT");
      if (sql.startsWith("SELECT")) return [[{ id: 2, name: "B\u200Bob" }], undefined];
      return [{ affectedRows: 1 }, undefined];
    });
    const getConnection = jest.fn(async () => fakeConnection({ execute, release }));

    await expect(cleanStoredNames(fakePool({ execute, getConnection }))).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("nettoyage des noms");
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"))).toHaveLength(2);
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO bg_settings"))).toBe(false);
  });

  it("arrête la passe à la première écriture en échec (verrou tenu) : une seule attente, pas de marqueur", async () => {
    const { execute, pool } = database(
      {
        bg_teams: [
          { id: 1, name: "A​b" },
          { id: 2, name: "C​d" },
        ],
        bg_users: [{ id: 3, name: "E​f" }],
      },
      () => {
        throw mysqlError("ER_LOCK_WAIT_TIMEOUT");
      },
    );

    await expect(cleanStoredNames(pool)).resolves.toBeUndefined();

    expect(updates(execute)).toHaveLength(1);
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO bg_settings"))).toBe(false);
  });

  it("détruit la connexion de passe quand le délai ne peut lui être rendu", async () => {
    const release = jest.fn<() => void>();
    const destroy = jest.fn<() => void>();
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT 1 FROM bg_settings")) return [[], undefined];
      if (sql === "SET SESSION innodb_lock_wait_timeout = DEFAULT") throw mysqlError("PROTOCOL_CONNECTION_LOST");
      if (sql.startsWith("SELECT")) return [[], undefined];
      return [{ affectedRows: 1 }, undefined];
    });
    const getConnection = jest.fn(async () => fakeConnection({ execute, release, destroy }));

    await cleanStoredNames(fakePool({ execute, getConnection }));

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it("ne lit rien quand le marqueur est posé", async () => {
    const { execute, pool } = database({ bg_teams: [{ id: 1, name: "A\u200Bb" }] }, undefined, true);

    await cleanStoredNames(pool);

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual(["SELECT 1 FROM bg_settings WHERE setting_key = ? LIMIT 1"]);
  });

  it("pose le marqueur une fois la passe menée à bout, lignes laissées comprises", async () => {
    const { execute, pool } = database({ bg_teams: [{ id: 1, name: "\u200B" }] });

    await cleanStoredNames(pool);

    const marker = execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO bg_settings"));
    expect(marker?.[1]).toEqual([CLEAN_STORED_NAMES_MARKER]);
  });

  it("n'attrape que le doublon : une autre erreur d'écriture est signalée, la passe reste à rejouer", async () => {
    const { execute, pool } = database({ bg_teams: [{ id: 1, name: "A\u200Bb" }] }, () => {
      throw mysqlError("ER_LOCK_WAIT_TIMEOUT");
    });

    await cleanStoredNames(pool);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("UPDATE bg_teams.name");
    expect(logged()).not.toContain("laissé(s)");
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO bg_settings"))).toBe(false);
  });

  it("raccourcit l'attente de verrou pour la passe, la rend au pool, et libère la connexion", async () => {
    const { execute, release, pool } = database({ bg_teams: [{ id: 1, name: "Ab" }] });

    await cleanStoredNames(pool);

    const sets = execute.mock.calls.map(([sql]) => sql).filter((sql) => sql.startsWith("SET SESSION"));
    expect(sets).toEqual(["SET SESSION innodb_lock_wait_timeout = 5", "SET SESSION innodb_lock_wait_timeout = DEFAULT"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("journalise les identifiants des équipes et tournois laissés, jamais ceux des joueurs ni un nom", async () => {
    const { pool } = database(
      {
        bg_teams: [{ id: 11, name: "\u200B" }],
        bg_users: [{ id: 22, name: "\u200B" }],
        bg_tournaments: [{ id: 33, name: "\u2060" }],
      },
    );

    await cleanStoredNames(pool);

    expect(logged()).toContain("bg_teams.name : 0 nom(s) réécrit(s) sans caractère invisible, 1 laissé(s) tel(s) quel(s) (vide une fois nettoyé, ou doublon) (id : 11).");
    expect(logged()).toContain("(id : 33)");
    expect(logged()).not.toContain("22");
  });
});
