import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/solo-entries-service");

import { anonymizeAccount } from "@/lib/server/users/account-erasure";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * La suppression du compte emporte ses alertes d'annonces GETI et leurs traces
 * (`GETI_INFO.md` § Alertes) : l'anonymisation garde la ligne `bg_users`, la
 * cascade ne joue pas.
 */

function missingTable(): Error {
  return Object.assign(new Error("Table 'bg.bg_geti_alerts' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
}

describe("anonymisation d'un compte — alertes d'annonces GETI", () => {
  it("anonymizeAccount_getiAlerts_deletesHitsThenAlertsOfTheAccount", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const sqls = execute.mock.calls.map(([sql, params]) => [sql.replace(/\s+/g, " ").trim(), params]);
    expect(sqls).toContainEqual([
      "DELETE FROM bg_geti_alert_hits WHERE alert_id IN (SELECT id FROM bg_geti_alerts WHERE user_id = ?)",
      [42],
    ]);
    expect(sqls).toContainEqual(["DELETE FROM bg_geti_alerts WHERE user_id = ?", [42]]);
  });

  it("anonymizeAccount_getiAlertsTableMissing_stillErasesTheAccount", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      if (sql.includes("bg_geti_alert")) throw missingTable();
      return [[], []];
    });

    await anonymizeAccount(fakeConnection({ execute }), 42);

    // Les effacements suivants ont eu lieu : la table absente n'a rien arrêté.
    expect(execute.mock.calls.some(([sql]) => sql.includes("DELETE FROM bg_terms_acceptances"))).toBe(true);
  });
});
