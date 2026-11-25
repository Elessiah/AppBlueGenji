import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/solo-entries-service");

import { anonymizeAccount } from "@/lib/server/users/account-erasure";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * La suppression du compte emporte son compteur des messages du staff
 * (`TOURNAMENT_STAFF_MESSAGE.md`) : l'anonymisation garde la ligne `bg_users`,
 * la cascade ne joue pas.
 */

function missingTable(): Error {
  return Object.assign(new Error("Table 'bg.bg_tournament_staff_message_quota' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
}

describe("anonymisation d'un compte — compteur des messages du staff", () => {
  it("anonymizeAccount_staffMessageQuota_deletesRowsOfTheAccount", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const sqls = execute.mock.calls.map(([sql, params]) => [sql.replace(/\s+/g, " ").trim(), params]);
    expect(sqls).toContainEqual(["DELETE FROM bg_tournament_staff_message_quota WHERE user_id = ?", [42]]);
  });

  it("anonymizeAccount_staffMessageQuotaTableMissing_stillErasesTheAccount", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      if (sql.includes("bg_tournament_staff_message_quota")) throw missingTable();
      return [[], []];
    });

    await anonymizeAccount(fakeConnection({ execute }), 42);

    // Les effacements suivants ont eu lieu : la table absente n'a rien arrêté.
    expect(execute.mock.calls.some(([sql]) => sql.includes("DELETE FROM bg_planning_profiles"))).toBe(true);
  });
});
