import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { writeSoloCaster } from "@/lib/server/planning/profiles";
import { fakeConnection, type SqlQuery } from "../../../helpers/sql-double";

/** `writeSoloCaster` : le réglage écrit, et « changé » lu dans la réponse de la base. */

/** Réponse d'un `UPDATE` : `changedRows` dit le changement réel, `affectedRows` les lignes trouvées. */
const updated = (changedRows: number, affectedRows = changedRows) => [{ affectedRows, changedRows }, []];
/** Réponse d'un `INSERT` : `affectedRows` seul. */
const written = (affectedRows: number) => [{ affectedRows }, []];

let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  execute = jest.fn<SqlQuery>();
});

describe("writeSoloCaster", () => {
  it("writeSoloCaster_differingRow_returnsTrueWithoutInsert", async () => {
    execute.mockResolvedValueOnce(updated(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual([expect.stringMatching(/SET solo_caster = \? WHERE user_id = \?$/), [0, 4]]);
  });

  it("writeSoloCaster_clearNoRowOrUnchanged_returnsFalseWithoutInsert", async () => {
    execute.mockResolvedValueOnce(updated(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(false);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("writeSoloCaster_setMissingRow_insertsAndReturnsTrue", async () => {
    execute.mockResolvedValueOnce(updated(0)).mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(true);

    expect(execute.mock.calls[1]).toEqual([expect.stringMatching(/^INSERT INTO bg_planning_profiles/), [4]]);
  });

  it("writeSoloCaster_setRowBornMeanwhile_duplicateKeyReadsAsUnchanged", async () => {
    execute
      .mockResolvedValueOnce(updated(0))
      .mockRejectedValueOnce(Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);
  });

  it("writeSoloCaster_insertFailsOtherwise_rethrows", async () => {
    // Compte disparu (clé étrangère) : jamais un « enregistré » qui n'a rien écrit.
    const failure = Object.assign(new Error("FK"), { code: "ER_NO_REFERENCED_ROW_2" });
    execute.mockResolvedValueOnce(updated(0)).mockRejectedValueOnce(failure);

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).rejects.toBe(failure);
  });

  it("writeSoloCaster_noChangedRowsField_neverReadsAsChanged", async () => {
    // Réponse muette sur les lignes modifiées : au pire un avis de moins, jamais un faux.
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("writeSoloCaster_setAlreadyOnRowFound_returnsFalseWithoutInsert", async () => {
    // Ligne trouvée mais inchangée (CLIENT_FOUND_ROWS) : pas d'INSERT voué à la clé en double.
    execute.mockResolvedValueOnce(updated(0, 1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("writeSoloCaster_clearUnchangedRowFound_returnsFalse", async () => {
    execute.mockResolvedValueOnce(updated(0, 1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(false);
  });
});
