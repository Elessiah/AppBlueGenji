import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { writeSoloCaster } from "@/lib/server/planning/profiles";
import { fakeConnection, type SqlQuery } from "../../../helpers/sql-double";

/** `writeSoloCaster` : le réglage écrit, et « changé » lu dans la réponse de la base. */

const written = (affectedRows: number) => [{ affectedRows }, []];

let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  execute = jest.fn<SqlQuery>();
});

describe("writeSoloCaster", () => {
  it("writeSoloCaster_differingRow_returnsTrueWithoutInsert", async () => {
    execute.mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual([expect.stringMatching(/WHERE user_id = \? AND solo_caster <> \?/), [0, 4, 0]]);
  });

  it("writeSoloCaster_clearWithoutDifferingRow_returnsFalseWithoutInsert", async () => {
    execute.mockResolvedValueOnce(written(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, false)).resolves.toBe(false);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("writeSoloCaster_setMissingRow_insertsAndReturnsTrue", async () => {
    execute.mockResolvedValueOnce(written(0)).mockResolvedValueOnce(written(1));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(true);

    expect(execute.mock.calls[1]).toEqual([expect.stringMatching(/^INSERT IGNORE INTO bg_planning_profiles/), [4]]);
  });

  it("writeSoloCaster_setAlreadyOn_returnsFalse", async () => {
    execute.mockResolvedValueOnce(written(0)).mockResolvedValueOnce(written(0));

    await expect(writeSoloCaster(fakeConnection({ execute }), 4, true)).resolves.toBe(false);
  });
});
