import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/blocked-images");
jest.mock("@/lib/server/tournaments/match-casters");

import { pinAccountBlockedHashesOn } from "@/lib/server/blocked-images";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { eraseAccount } from "@/lib/server/users/account-erasure";
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
});
