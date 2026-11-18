import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/solo-entries-service");

import { anonymizeAccount } from "@/lib/server/users/account-erasure";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/** La suppression du compte emporte son planning ; ses gestes de staff restent, sans le désigner (CAST_PLANNING.md). */

async function erasureStatements() {
  jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
  const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
  await anonymizeAccount(fakeConnection({ execute }), 42);
  return execute.mock.calls.map(([sql, params]) => [sql.replace(/\s+/g, " ").trim(), params]);
}

describe("anonymisation d'un compte — planning des casts et arbitres", () => {
  it("anonymizeAccount_planningRows_deletedForTheAccount", async () => {
    const sqls = await erasureStatements();
    for (const table of ["bg_planning_availability", "bg_planning_assignments", "bg_planning_events", "bg_planning_profiles"]) {
      expect(sqls).toContainEqual([`DELETE FROM ${table} WHERE user_id = ?`, [42]]);
    }
  });

  it("anonymizeAccount_staffGestures_keptWithoutActor", async () => {
    const sqls = await erasureStatements();
    expect(sqls).toContainEqual(["UPDATE bg_planning_events SET actor_user_id = NULL WHERE actor_user_id = ?", [42]]);
    expect(sqls).toContainEqual(["UPDATE bg_planning_assignments SET assigned_by_user_id = NULL WHERE assigned_by_user_id = ?", [42]]);
  });
});
