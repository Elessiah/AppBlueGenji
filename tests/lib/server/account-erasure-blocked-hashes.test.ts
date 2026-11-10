import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/blocked-images");
jest.mock("@/lib/server/tournaments/match-casters");

import { pinAccountBlockedHashesOn } from "@/lib/server/blocked-images";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { eraseAccount } from "@/lib/server/users/account-erasure";
import { readSource } from "../../helpers/read-source";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/*
 * Revue sécurité #571, cycle 2 (D18) : tout effacement — demande au jour 30
 * comme rattrapage au démarrage (`reconcileDeletedAccounts`) — rend non
 * levables les blocages que les lignes de quarantaine du compte justifiaient,
 * avant que la cascade ne les emporte.
 */
describe("eraseAccount — blocages d'empreinte", () => {
  it("eraseAccount_anyCaller_pinsBlockedHashesBeforeDeletingAccount", async () => {
    jest.mocked(withdrawUserCasts).mockResolvedValue({ matchIds: [], tournamentIds: [] });
    jest.mocked(pinAccountBlockedHashesOn).mockResolvedValue(undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    const connection = fakeConnection({ execute });

    await eraseAccount(connection, 42);

    expect(pinAccountBlockedHashesOn).toHaveBeenCalledWith(connection, 42);
    const deleteCall = execute.mock.calls.findIndex(([sql]) => sql === "DELETE FROM bg_users WHERE id = ?");
    expect(jest.mocked(pinAccountBlockedHashesOn).mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[deleteCall],
    );
  });

  // D31 : à l'effacement, le blocage ne garde que l'empreinte — les lignes qui
  // la reliaient au compte partent dans la même transaction.
  it("eraseAccount_erase_deletesQuarantineLinksAfterPinningInSameTransaction", async () => {
    jest.mocked(withdrawUserCasts).mockResolvedValue({ matchIds: [], tournamentIds: [] });
    jest.mocked(pinAccountBlockedHashesOn).mockResolvedValue(undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    const connection = fakeConnection({ execute });

    await eraseAccount(connection, 42);

    const sqls = execute.mock.calls.map(([sql]) => sql);
    const unlink = sqls.indexOf("DELETE FROM bg_logo_quarantines WHERE user_id = ?");
    expect(unlink).toBeGreaterThanOrEqual(0);
    expect(execute.mock.calls[unlink][1]).toEqual([42]);
    expect(jest.mocked(pinAccountBlockedHashesOn).mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[unlink],
    );
    expect(unlink).toBeLessThan(sqls.indexOf("DELETE FROM bg_users WHERE id = ?"));
  });

  // D31 : l'empreinte bloquée ne nomme aucun compte (table sans colonne de compte).
  it("eraseAccount_erase_blockedHashTableHasNoAccountColumn", async () => {
    const source = readSource("lib/server/database/schema/compliance.ts");
    const start = source.indexOf("CREATE TABLE IF NOT EXISTS bg_blocked_image_hashes");
    const table = start < 0 ? undefined : source.slice(start, source.indexOf(") ENGINE", start));

    expect(table).toBeDefined();
    expect(table).not.toMatch(/user_id|account|report_id|quarantine_id/i);
  });
});
