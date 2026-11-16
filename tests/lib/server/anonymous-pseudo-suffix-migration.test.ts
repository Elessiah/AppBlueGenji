import { describe, expect, it, jest } from "@jest/globals";
import { applyRecentSchemaChanges } from "@/lib/server/database/recent-schema-changes";
import { ANONYMOUS_PSEUDOS } from "@/lib/shared/anonymous-pseudos";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * D99 (EF-65) : les comptes déjà anonymisés ou en attente sous un nom tiré de
 * la liste publique (nu, ou suivi des chiffres de l'ancien tirage de secours)
 * reçoivent un suffixe aléatoire au démarrage, puis leur entrée solo suit le
 * pseudo.
 */

const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const SOLO_PREFIX = "UPDATE IGNORE bg_teams s JOIN bg_users u ON u.id = s.solo_user_id";

async function migrationStatements() {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
  await applyRecentSchemaChanges(fakePool({ execute }));
  const sqls = execute.mock.calls.map(([sql]) => oneLine(String(sql)));
  const rename = sqls.find((sql) => sql.includes("RANDOM_BYTES"));
  const solo = sqls.filter((sql) => sql.startsWith(SOLO_PREFIX));
  return { sqls, rename, solo };
}

describe("RECENT_SCHEMA_CHANGES — suffixe des pseudos d'emprunt (D99)", () => {
  it("recentSchemaChanges_bareBorrowedPseudo_appendsSixBase36FromRandomBytesAndId", async () => {
    const { rename } = await migrationStatements();

    // L'identifiant entre dans l'empreinte : un suffixe propre à chaque ligne
    // même si le moteur ne tirait `RANDOM_BYTES` qu'une fois par instruction.
    expect(rename).toContain(
      "SET pseudo = CONCAT(pseudo, '-', LOWER(LPAD(RIGHT(CONV(LEFT(SHA2(CONCAT(HEX(RANDOM_BYTES(16)), '-', id), 256), 15), 16, 36), 6), 6, '0')))",
    );
  });

  it("recentSchemaChanges_rename_ignoresDuplicateRowsInsteadOfRollingBackAll", async () => {
    const { rename } = await migrationStatements();

    expect(rename?.startsWith("UPDATE IGNORE bg_users")).toBe(true);
  });

  it("recentSchemaChanges_rename_targetsDeletedAccountsUnderAListNameOrListNamePlusDigits", async () => {
    const { rename } = await migrationStatements();

    expect(rename).toContain("WHERE is_deleted = 1 AND ( pseudo IN ('AlphaFX', ");
    expect(rename).toContain("pseudo REGEXP '[0-9]{3}$'");
    for (const digits of [3, 4, 5]) {
      expect(rename).toContain(`LEFT(pseudo, CHAR_LENGTH(pseudo) - ${digits}) IN ('AlphaFX', `);
    }
    expect(rename).toContain(`'${ANONYMOUS_PSEUDOS[999]}')`);
    // Quatre listes de mille, plus « - » (deux fois), « 0 » et le motif des chiffres.
    expect(rename?.match(/'[^']*'/g)?.length).toBe(4 * ANONYMOUS_PSEUDOS.length + 4);
  });

  it("recentSchemaChanges_rename_neverTargetsLegacyOrLiveAccounts", async () => {
    const { rename } = await migrationStatements();

    expect(rename).not.toContain("compte_supprime");
    expect(rename).not.toContain("is_deleted = 0");
  });

  it("recentSchemaChanges_soloEntries_followPseudoThenPseudoHashIdNeverJoueurId", async () => {
    const { sqls, rename, solo } = await migrationStatements();
    const where =
      "WHERE u.is_deleted = 1 AND u.pseudo COLLATE utf8mb4_bin REGEXP '-[0-9a-z]{6}$' AND s.name <> u.pseudo AND s.name <> CONCAT(u.pseudo, ' #', u.id)";

    expect(solo).toEqual([
      `${SOLO_PREFIX} SET s.name = u.pseudo ${where}`,
      `${SOLO_PREFIX} SET s.name = CONCAT(u.pseudo, ' #', u.id) ${where}`,
    ]);
    expect(solo.join(" ")).not.toContain("Joueur #");
    expect(sqls.indexOf(solo[0])).toBe(sqls.indexOf(rename!) + 1);
    expect(sqls.indexOf(solo[1])).toBe(sqls.indexOf(rename!) + 2);
  });

  it("recentSchemaChanges_renameFails_skipsSoloSteps", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (String(sql).includes("RANDOM_BYTES")) throw Object.assign(new Error("Parse error"), { code: "ER_PARSE_ERROR", errno: 1064 });
      return [{ affectedRows: 0 }, []];
    });

    await applyRecentSchemaChanges(fakePool({ execute }));

    expect(execute.mock.calls.some(([sql]) => oneLine(String(sql)).startsWith(SOLO_PREFIX))).toBe(false);
    error.mockRestore();
  });
});
