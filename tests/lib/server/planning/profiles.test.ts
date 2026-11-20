import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { writeSoloCaster } from "@/lib/server/planning/profiles";
import { fakeConnection, type SqlQuery } from "../../../helpers/sql-double";

/** `writeSoloCaster` : le réglage écrit, et « changé » lu dans les lignes que la base a écrites. */

/** Réponse d'une écriture : `affectedRows` seul (jamais `changedRows`, que rien n'exige). */
const written = (affectedRows: number) => [{ affectedRows }, []];
const duplicate = () => Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });

let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  execute = jest.fn<SqlQuery>();
});

describe("writeSoloCaster", () => {
  it("writeSoloCaster_otherValueRow_conditionalUpdateReturnsTrue", async () => {
    execute.mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual([expect.stringMatching(/WHERE user_id = \? AND solo_caster <> \?$/), [0, 4, 0]]);
  });

  it("writeSoloCaster_clearNothingToChange_returnsFalseWithoutInsert", async () => {
    execute.mockResolvedValueOnce(written(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(false);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("writeSoloCaster_setMissingRow_insertSelectCreatesRowReturnsTrue", async () => {
    execute.mockResolvedValueOnce(written(0)).mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(true);

    expect(execute.mock.calls[1]).toEqual([expect.stringMatching(/^INSERT INTO bg_planning_profiles[\s\S]*WHERE NOT EXISTS/), [4, 4]]);
  });

  it("writeSoloCaster_setAlreadyOn_insertSelectNoopReturnsFalse", async () => {
    // Ligne déjà « oui » : l'INSERT conditionnel n'écrit rien, sans erreur de clé.
    execute.mockResolvedValueOnce(written(0)).mockResolvedValueOnce(written(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("writeSoloCaster_rowBornMeanwhileWithOff_duplicateReRunsUpdateReturnsTrue", async () => {
    execute.mockResolvedValueOnce(written(0)).mockRejectedValueOnce(duplicate()).mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(true);

    expect(execute.mock.calls[2]).toEqual([expect.stringMatching(/solo_caster <> \?$/), [1, 4, 1]]);
  });

  it("writeSoloCaster_rowBornMeanwhileWithOn_duplicateReRunsUpdateReturnsFalse", async () => {
    execute.mockResolvedValueOnce(written(0)).mockRejectedValueOnce(duplicate()).mockResolvedValueOnce(written(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);
  });

  it("writeSoloCaster_insertFailsOtherwise_rethrows", async () => {
    // Compte disparu (clé étrangère) : jamais un « enregistré » qui n'a rien écrit.
    const failure = Object.assign(new Error("FK"), { code: "ER_NO_REFERENCED_ROW_2" });
    execute.mockResolvedValueOnce(written(0)).mockRejectedValueOnce(failure);

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).rejects.toBe(failure);
  });

  it("writeSoloCaster_noChangedRowsField_updateAffectedRowsReadsAsChanged", async () => {
    // Réponse sans `changedRows` (texte d'information absent) : le changement se lit quand même.
    execute.mockResolvedValueOnce([{ affectedRows: 1, info: "" }, []]);

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
