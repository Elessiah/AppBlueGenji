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

/** Les instructions jouées par les migrations, sur une base qui répond sans erreur. */
async function migrationStatements(): Promise<string[]> {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }, []]);
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
});
