import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/blocked-images");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/match-casters");

import { retireAccountQuarantinesOn } from "@/lib/server/blocked-images";
import { getDatabase } from "@/lib/server/database";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { eraseAccount } from "@/lib/server/users/account-erasure";
import { readSource } from "../../helpers/read-source";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/*
 * Revue sécurité #571, cycle 2 (D18) : tout effacement — demande au jour 30
 * comme rattrapage au démarrage (`reconcileDeletedAccounts`) — rend non
 * levables les blocages que les lignes de quarantaine du compte justifiaient,
 * avant de les retirer (D31).
 */
const emptyWithdrawal = () => ({
  matchIds: [],
  tournamentIds: [],
  liveTournamentIds: [],
  releasedRefereeMatchIds: [],
  releasedCastMatchIds: [],
  releasedProdPlaces: [],
});

describe("eraseAccount — blocages d'empreinte", () => {
  // D31 : à l'effacement, les lignes qui reliaient l'empreinte au compte partent
  // sur la connexion de l'appelant (sa transaction), jamais sur le pool.
  it("eraseAccount_erase_retiresQuarantinesBeforeDeletingAccountOnCallerConnection", async () => {
    jest.mocked(withdrawUserCasts).mockResolvedValue({
      matchIds: [],
      tournamentIds: [],
      liveTournamentIds: [],
      releasedRefereeMatchIds: [],
      releasedCastMatchIds: [],
      releasedProdPlaces: [],
    });
    jest.mocked(retireAccountQuarantinesOn).mockResolvedValue(undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    const connection = fakeConnection({ execute });

    await eraseAccount(connection, 42);

    expect(retireAccountQuarantinesOn).toHaveBeenCalledWith(connection, 42);
    const deleteCall = execute.mock.calls.findIndex(([sql]) => sql === "DELETE FROM bg_users WHERE id = ?");
    expect(jest.mocked(retireAccountQuarantinesOn).mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[deleteCall],
    );
    expect(getDatabase).not.toHaveBeenCalled();
  });

  // T16 : une prod gardée par un match joué perd son compte (clé étrangère SET NULL) ; sa marque part avec.
  it("eraseAccount_erase_clearsProdPlannedBeforeDeletingAccount", async () => {
    jest.mocked(withdrawUserCasts).mockResolvedValue(emptyWithdrawal());
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);

    await eraseAccount(fakeConnection({ execute }), 42);

    const sqls = execute.mock.calls.map(([sql]) => sql);
    const clear = sqls.indexOf("UPDATE bg_matches SET prod_planned = 0 WHERE prod_user_id = ? AND prod_planned = 1");
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(execute.mock.calls[clear][1]).toEqual([42]);
    expect(clear).toBeLessThan(sqls.indexOf("DELETE FROM bg_users WHERE id = ?"));
  });

  it("eraseAccount_prodPlannedColumnMissing_stillDeletesAccount", async () => {
    jest.mocked(withdrawUserCasts).mockResolvedValue(emptyWithdrawal());
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (String(sql).includes("prod_planned")) throw Object.assign(new Error("Unknown column 'prod_planned'"), { code: "ER_BAD_FIELD_ERROR" });
      return [{ affectedRows: 1 }, []];
    });

    await eraseAccount(fakeConnection({ execute }), 42);

    expect(execute.mock.calls.map(([sql]) => sql)).toContain("DELETE FROM bg_users WHERE id = ?");
  });

  it("eraseAccount_prodPlannedOtherFailure_rethrows", async () => {
    jest.mocked(withdrawUserCasts).mockResolvedValue(emptyWithdrawal());
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (String(sql).includes("prod_planned")) throw new Error("DB_DOWN");
      return [{ affectedRows: 1 }, []];
    });

    await expect(eraseAccount(fakeConnection({ execute }), 42)).rejects.toThrow("DB_DOWN");
  });

  // D31 : l'empreinte bloquée ne nomme aucun compte (table sans colonne de compte).
  it("eraseAccount_erase_blockedHashTableHasNoAccountColumn", async () => {
    const source = readSource("lib/server/database/schema/compliance.ts");
    const start = source.indexOf("CREATE TABLE IF NOT EXISTS bg_blocked_image_hashes");
    const table = start < 0 ? undefined : source.slice(start, source.indexOf(") ENGINE", start));

    expect(table).toBeDefined();
    expect(table).not.toMatch(/user_id|account|report_id|quarantine_id/i);
  });

  // D31 : une base existante ne gagne pas non plus de colonne de compte.
  it("recentSchemaChanges_blockedHashAlters_addNoAccountColumn", () => {
    const source = readSource("lib/server/database/recent-schema-changes.ts");
    const alters = source.match(/ALTER TABLE bg_blocked_image_hashes[^`]*/g);

    expect(alters).not.toBeNull();
    expect(alters?.join(" ")).not.toMatch(/user_id|account|report_id|quarantine_id/i);
  });
});
