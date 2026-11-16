import { describe, expect, it, jest } from "@jest/globals";
import { applyRecentSchemaChanges } from "@/lib/server/database/recent-schema-changes";
import { ANONYMOUS_PSEUDOS } from "@/lib/shared/anonymous-pseudos";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * D99 (EF-65) : les comptes déjà anonymisés ou en attente sous un nom nu de la
 * liste publique reçoivent un suffixe aléatoire au démarrage, puis leur entrée
 * solo suit le pseudo.
 */

const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();

async function migrationStatements() {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
  await applyRecentSchemaChanges(fakePool({ execute }));
  const sqls = execute.mock.calls.map(([sql]) => oneLine(String(sql)));
  const rename = sqls.find((sql) => sql.includes("RANDOM_BYTES"));
  const solo = sqls.find((sql) => sql.startsWith("UPDATE bg_teams s JOIN bg_users u ON u.id = s.solo_user_id"));
  return { sqls, rename, solo };
}

describe("RECENT_SCHEMA_CHANGES — suffixe des pseudos d'emprunt (D99)", () => {
  it("recentSchemaChanges_bareBorrowedPseudo_appendsSixBase36RandomChars", async () => {
    const { rename } = await migrationStatements();

    expect(rename).toContain(
      "SET pseudo = CONCAT(pseudo, '-', LOWER(LPAD(RIGHT(CONV(HEX(RANDOM_BYTES(8)), 16, 36), 6), 6, '0')))",
    );
  });

  it("recentSchemaChanges_rename_targetsOnlyDeletedAccountsUnderAListName", async () => {
    const { rename } = await migrationStatements();

    expect(rename).toContain("WHERE is_deleted = 1 AND pseudo IN ('AlphaFX', ");
    expect(rename).toContain(`'${ANONYMOUS_PSEUDOS[999]}')`);
    expect(rename?.match(/'[^']*'/g)?.length).toBe(ANONYMOUS_PSEUDOS.length + 2);
  });

  it("recentSchemaChanges_soloEntries_followSuffixedPseudoUnlessFallbackName", async () => {
    const { sqls, rename, solo } = await migrationStatements();

    expect(solo).toBe(
      "UPDATE bg_teams s JOIN bg_users u ON u.id = s.solo_user_id SET s.name = u.pseudo WHERE u.is_deleted = 1 AND u.pseudo REGEXP '-[0-9a-z]{6}$' AND s.name <> u.pseudo AND s.name <> CONCAT(u.pseudo, ' #', u.id) AND s.name <> CONCAT('Joueur #', u.id)",
    );
    expect(sqls.indexOf(solo!)).toBe(sqls.indexOf(rename!) + 1);
  });

  it("recentSchemaChanges_renameFails_skipsSoloStep", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (String(sql).includes("RANDOM_BYTES")) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
      return [{ affectedRows: 0 }, []];
    });

    await applyRecentSchemaChanges(fakePool({ execute }));

    expect(execute.mock.calls.some(([sql]) => oneLine(String(sql)).startsWith("UPDATE bg_teams s JOIN bg_users u"))).toBe(false);
    error.mockRestore();
  });
});
