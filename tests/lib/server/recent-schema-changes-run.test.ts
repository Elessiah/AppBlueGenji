import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { applySchemaChange } from "@/lib/server/database/recent-schema-changes";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

const lockWait = () =>
  Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
const duplicateColumn = () => Object.assign(new Error("Duplicate column name 'purpose'"), { code: "ER_DUP_FIELDNAME", errno: 1060 });
const diskFull = () => Object.assign(new Error("The table is full"), { code: "ER_RECORD_FILE_FULL", errno: 1114 });

const ADD = "ALTER TABLE bg_x ADD COLUMN purpose ENUM('A') NULL";
const FILL = "UPDATE bg_x SET purpose = 'A' WHERE purpose IS NULL";
const TIGHTEN = "ALTER TABLE bg_x MODIFY purpose ENUM('A') NOT NULL";
const WHEN = "SELECT 1 FROM information_schema.COLUMNS";

describe("applySchemaChange", () => {
  let error: jest.SpiedFunction<typeof console.error>;
  beforeEach(() => {
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => error.mockRestore());

  const sqlsOf = (execute: jest.Mock<SqlQuery>) => execute.mock.calls.map(([sql]) => String(sql));

  it("applySchemaChange_transientLockWaitOnce_replaysAndSucceedsSilently", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(lockWait()).mockResolvedValueOnce([{ affectedRows: 0 }]);

    await applySchemaChange(fakePool({ execute }), ADD);

    expect(sqlsOf(execute)).toEqual([ADD, ADD]);
    expect(error).not.toHaveBeenCalled();
  });

  it("applySchemaChange_transientLockWaitEveryTime_reportsAfterThreeTries", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(lockWait());

    await applySchemaChange(fakePool({ execute }), ADD);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("applySchemaChange_groupFirstStepFails_skipsDependentSteps", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(diskFull());

    await applySchemaChange(fakePool({ execute }), { steps: [ADD, FILL, TIGHTEN] });

    expect(sqlsOf(execute)).toEqual([ADD]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("applySchemaChange_groupFirstStepNoOp_runsDependentSteps", async () => {
    // Colonne déjà là : le remplissage et le resserrement, idempotents, suivent.
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(duplicateColumn()).mockResolvedValue([{ affectedRows: 0 }]);

    await applySchemaChange(fakePool({ execute }), { steps: [ADD, FILL, TIGHTEN] });

    expect(sqlsOf(execute)).toEqual([ADD, FILL, TIGHTEN]);
    expect(error).not.toHaveBeenCalled();
  });

  it("applySchemaChange_whenReadsNoRow_skipsGroup", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);

    await applySchemaChange(fakePool({ execute }), { when: WHEN, steps: [TIGHTEN] });

    expect(sqlsOf(execute)).toEqual([WHEN]);
  });

  it("applySchemaChange_whenReadsARow_runsGroup", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ found: 1 }]]).mockResolvedValue([{ affectedRows: 0 }]);

    await applySchemaChange(fakePool({ execute }), { when: WHEN, steps: [TIGHTEN] });

    expect(sqlsOf(execute)).toEqual([WHEN, TIGHTEN]);
  });

  it("applySchemaChange_whenReadFails_reportsAndSkipsGroup", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValueOnce(diskFull());

    await applySchemaChange(fakePool({ execute }), { when: WHEN, steps: [TIGHTEN] });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
