import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import {
  designationTookEffect,
  readPlanningRows,
  settleFailedDesignation,
  undoPlanningBlock,
  type PlanningAssignmentRow,
} from "@/lib/server/planning/planning-undo";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** Annulation d'un geste manuel dont la désignation du match n'a pas pris (`CAST_PLANNING.md` § Gestes). */

const connection = connectionMock();
const { execute } = connection;
const EMPTY = { entryKeys: [], rows: [] };

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockResolvedValue([{ affectedRows: 1 }]);
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
});

describe("readPlanningRows", () => {
  it("readPlanningRows_noKeys_noQuery", async () => {
    const actual = await readPlanningRows(fakeConnection(connection), []);

    expect(actual).toEqual(EMPTY);
    expect(execute).not.toHaveBeenCalled();
  });

  it("readPlanningRows_duplicateKeys_oneDedupedSelect", async () => {
    execute.mockResolvedValueOnce([[{ entry_key: "m:1" }], []]);

    const actual = await readPlanningRows(fakeConnection(connection), ["m:1", "m:2", "m:1"]);

    expect(actual.entryKeys).toEqual(["m:1", "m:2"]);
    expect(execute.mock.calls[0][1]).toEqual(["m:1", "m:2"]);
  });
});

describe("designationTookEffect", () => {
  it("designationTookEffect_matchRefusal_falseWithoutRead", async () => {
    await expect(designationTookEffect(new Error("REFEREE_IS_PLAYER"), 1, 3)).resolves.toBe(false);

    expect(execute).not.toHaveBeenCalled();
  });

  it("designationTookEffect_panneMatchHasWanted_true", async () => {
    execute.mockResolvedValueOnce([[{ referee_user_id: 3 }], []]);

    await expect(designationTookEffect(new Error("ER_LOCK_DEADLOCK"), 1, 3)).resolves.toBe(true);
  });

  it("designationTookEffect_panneMatchHasOther_false", async () => {
    execute.mockResolvedValueOnce([[{ referee_user_id: 7 }], []]);

    await expect(designationTookEffect(new Error("ER_LOCK_DEADLOCK"), 1, 3)).resolves.toBe(false);
  });

  it("designationTookEffect_readFails_undefined", async () => {
    execute.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(designationTookEffect(new Error("ER_LOCK_DEADLOCK"), 1, null)).resolves.toBeUndefined();
  });

  it("designationTookEffect_matchGone_undefined", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await expect(designationTookEffect(new Error("ER_LOCK_DEADLOCK"), 1, null)).resolves.toBeUndefined();
  });
});

describe("undoPlanningBlock", () => {
  it("undoPlanningBlock_rowsAndEvents_restoredInOneTransaction", async () => {
    const createdAt = new Date("2026-11-16T19:00:00Z");
    const row: PlanningAssignmentRow = {
      entry_key: "m:1", user_id: 7, role: "REFEREE", tournament_id: 10, match_id: 1,
      source: "AUTO", reason: "LOAD", confirmed: 0, assigned_by_user_id: 9, created_at: createdAt,
    };

    const actual = await undoPlanningBlock({ entryKeys: ["m:1"], rows: [row] }, [77]);

    expect(actual).toBe(true);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 7, "REFEREE", 10, 1, "AUTO", "LOAD", 0, 9, createdAt]);
    expect(execute.mock.calls[2][1]).toEqual([77]);
  });

  it("undoPlanningBlock_writeFails_loggedReturnsFalse", async () => {
    execute.mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    const actual = await undoPlanningBlock({ entryKeys: ["m:1"], rows: [] }, [77]);

    expect(actual).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("settleFailedDesignation", () => {
  it("settleFailedDesignation_designationTook_nothingUndone", async () => {
    execute.mockResolvedValueOnce([[{ referee_user_id: 3 }], []]);

    await settleFailedDesignation(new Error("PUBLISH_FAILED"), 1, 3, { entryKeys: ["m:1"], rows: [] }, [77]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("settleFailedDesignation_uncertain_loggedNothingUndone", async () => {
    execute.mockRejectedValueOnce(new Error("ECONNRESET"));

    await settleFailedDesignation(new Error("ER_LOCK_DEADLOCK"), 1, 3, { entryKeys: ["m:1"], rows: [] }, [77]);

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("settleFailedDesignation_refused_undone", async () => {
    await settleFailedDesignation(new Error("REFEREE_CHANGED"), 1, 3, { entryKeys: ["m:1"], rows: [] }, [77]);

    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[1][1]).toEqual([77]);
  });
});
