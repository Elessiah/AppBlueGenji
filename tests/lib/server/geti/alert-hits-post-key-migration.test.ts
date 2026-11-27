import { describe, expect, it, jest } from "@jest/globals";
import { applyRecentSchemaChanges } from "@/lib/server/database/recent-schema-changes";
import { fakePool, type SqlQuery } from "../../../helpers/sql-double";

/**
 * Traces d'alertes GETI (`docs/features/GETI_INFO.md` § Alertes) : sur une base
 * qui avait déjà `bg_geti_alert_hits` sans la clé vers l'annonce, les traces
 * orphelines partent puis la clé `ON DELETE CASCADE` est posée (ensuite des no-op).
 */

const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const ORPHANS =
  "DELETE h FROM bg_geti_alert_hits h LEFT JOIN bg_geti_posts p ON p.message_id = h.message_id WHERE p.id IS NULL";
const ADD_KEY =
  "ALTER TABLE bg_geti_alert_hits ADD CONSTRAINT fk_bg_geti_alert_hits_post FOREIGN KEY (message_id) REFERENCES bg_geti_posts(message_id) ON DELETE CASCADE";

const isKeyGuard = (sql: string) =>
  sql.startsWith("SELECT 1 FROM information_schema.TABLES") && sql.includes("fk_bg_geti_alert_hits_post");

/**
 * Les instructions jouées par les migrations, sur une base qui répond sans
 * erreur ; `keyMissing` : ce que rend la lecture de garde de la clé.
 */
async function migrationStatements(keyMissing = true): Promise<string[]> {
  const execute = jest.fn<SqlQuery>(async (sql) =>
    isKeyGuard(oneLine(String(sql))) ? [keyMissing ? [{ 1: 1 }] : [], []] : [{ affectedRows: 0 }, []],
  );
  await applyRecentSchemaChanges(fakePool({ execute }));
  return execute.mock.calls.map(([sql]) => oneLine(String(sql)));
}

describe("RECENT_SCHEMA_CHANGES — clé des traces d'alertes vers l'annonce", () => {
  it("applyRecentSchemaChanges_alertHitsWithoutPostKey_removesOrphansThenAddsKey", async () => {
    const sqls = await migrationStatements();

    const orphans = sqls.indexOf(ORPHANS);
    expect(orphans).toBeGreaterThan(-1);
    expect(sqls.indexOf(ADD_KEY)).toBe(orphans + 1);
  });

  it("applyRecentSchemaChanges_alertHitsKeyPresent_skipsOrphanScanAndKey", async () => {
    const sqls = await migrationStatements(false);

    expect(sqls).not.toContain(ORPHANS);
    expect(sqls).not.toContain(ADD_KEY);
  });

  it("applyRecentSchemaChanges_alertHitsGuard_readsTableAndReferentialConstraints", async () => {
    const sqls = await migrationStatements();

    const guard = sqls.find(isKeyGuard) ?? "";
    expect(guard).toContain("TABLE_NAME = 'bg_geti_alert_hits'");
    expect(guard).toContain("FROM information_schema.REFERENTIAL_CONSTRAINTS r");
    expect(guard).toContain("r.CONSTRAINT_NAME = 'fk_bg_geti_alert_hits_post'");
    expect(sqls.indexOf(ORPHANS)).toBe(sqls.indexOf(guard) + 1);
  });
});
