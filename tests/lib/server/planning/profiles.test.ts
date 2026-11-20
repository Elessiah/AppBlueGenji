import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { writeSoloCaster } from "@/lib/server/planning/profiles";
import { fakeConnection, type SqlQuery } from "../../../helpers/sql-double";

/** `writeSoloCaster` : le réglage écrit, et « changé » lu dans la réponse de la base. */

/** Réponse d'un `UPDATE` : `changedRows` dit le changement réel. */
const updated = (changedRows: number, affectedRows = changedRows) => [{ affectedRows, changedRows }, []];
/** Réponse d'un `INSERT IGNORE` : `affectedRows` seul. */
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
    expect(execute.mock.calls[0]).toEqual([expect.stringMatching(/WHERE user_id = \? AND solo_caster <> \?/), [0, 4, 0]]);
  });

  it("writeSoloCaster_clearWithoutDifferingRow_returnsFalseWithoutInsert", async () => {
    execute.mockResolvedValueOnce(updated(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(false);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("writeSoloCaster_setMissingRow_insertsAndReturnsTrue", async () => {
    execute.mockResolvedValueOnce(updated(0)).mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(true);

    expect(execute.mock.calls[1]).toEqual([expect.stringMatching(/^INSERT IGNORE INTO bg_planning_profiles/), [4]]);
  });

  it("writeSoloCaster_setAlreadyOn_returnsFalse", async () => {
    execute.mockResolvedValueOnce(updated(0)).mockResolvedValueOnce(written(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);
  });

  it("writeSoloCaster_foundRowsCountsUnchangedRow_returnsFalse", async () => {
    // Sous CLIENT_FOUND_ROWS, une ligne trouvée mais inchangée compte dans affectedRows.
    execute.mockResolvedValueOnce(updated(0, 1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(false);
  });
});
