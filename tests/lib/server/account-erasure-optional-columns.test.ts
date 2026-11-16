import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/solo-entries-service");

import { anonymizeAccount } from "@/lib/server/users/account-erasure";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/** EF-62 (E67) : les réglages facultatifs du compte anonymisé, remis en une instruction. */
const JOINT = "UPDATE bg_users SET match_dm_enabled = 1, recruitment_modal_off = 0";

function normalized(execute: jest.Mock<SqlQuery>): string[] {
  return execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
}

function unknownColumn(): Error {
  return Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
}

describe("anonymizeAccount — colonnes facultatives", () => {
  it("anonymizeAccount_allColumnsPresent_resetsThemInOneUpdate", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const resets = normalized(execute).filter((sql) => sql.includes("referee_objection_at = NULL"));
    expect(resets).toEqual([
      "UPDATE bg_users SET match_dm_enabled = 1, recruitment_modal_off = 0, discord_certify_prompt_dismissed_at = NULL, certification_prompt_dismissed_at = NULL, referee_objection_at = NULL WHERE id = ? AND is_deleted = 1",
    ]);
  });

  it("anonymizeAccount_unknownColumn_fallsBackColumnByColumn", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith(JOINT)) throw unknownColumn();
      if (q.startsWith("UPDATE bg_users SET referee_objection_at = NULL")) throw unknownColumn();
      return [[], []];
    });

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const sqls = normalized(execute);
    expect(sqls).toContain("UPDATE bg_users SET match_dm_enabled = 1 WHERE id = ? AND is_deleted = 1");
    expect(sqls).toContain("UPDATE bg_users SET certification_prompt_dismissed_at = NULL WHERE id = ? AND is_deleted = 1");
  });

  it("anonymizeAccount_otherErrorOnJointUpdate_rethrown", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.replace(/\s+/g, " ").trim().startsWith(JOINT)) throw new Error("Lock wait timeout exceeded");
      return [[], []];
    });

    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).rejects.toThrow("Lock wait timeout exceeded");
  });
});
