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
