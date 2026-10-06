import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/solo-entries-service");

import { anonymizeAccount } from "@/lib/server/users/account-erasure";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

describe("anonymisation d'un compte — détail map par map (MAP_SCORES.md)", () => {
  it("détache le compte des maps qu'il a saisies, le résultat restant", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const sqls = execute.mock.calls.map(([sql, params]) => [sql.replace(/\s+/g, " ").trim(), params]);
    expect(sqls).toContainEqual([
      "UPDATE bg_match_maps SET submitted_by_user_id = NULL WHERE submitted_by_user_id = ?",
      [42],
    ]);
    expect(sqls.some(([sql]) => String(sql).startsWith("DELETE FROM bg_match_maps"))).toBe(false);
  });
});
