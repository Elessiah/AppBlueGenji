import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import {
  designationTookEffect,
  readPlanningRows,
  settleFailedDesignation,
  snapshotGesture,
  undoPlanningBlock,
  type PlanningAssignmentRow,
  type PlanningUndo,
} from "@/lib/server/planning/planning-undo";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** Annulation d'un geste manuel dont la désignation du match n'a pas pris (`CAST_PLANNING.md` § Gestes). */

const connection = connectionMock();
const { execute } = connection;
const CREATED_AT = new Date("2026-11-16T19:00:00Z");

function row(overrides: Partial<PlanningAssignmentRow> = {}): PlanningAssignmentRow {
  return {
    entry_key: "m:1",
    user_id: 7,
    role: "REFEREE",
    tournament_id: 10,
    match_id: 1,
    source: "AUTO",
    reason: "LOAD",
    confirmed: 0,
    assigned_by_user_id: 9,
    created_at: CREATED_AT,
    ...overrides,
  };
}

const UNDO: PlanningUndo = { keys: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }], rows: [] };

/** Les requêtes jouées qui contiennent `fragment`. */
function callsWith(fragment: string) {
  return execute.mock.calls.filter(([sql]) => sql.includes(fragment));
}

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
  it("readPlanningRows_noKeys_emptyNoQuery", async () => {
    const actual = await readPlanningRows(fakeConnection(connection), []);

    expect(actual).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("readPlanningRows_duplicateKeys_oneDedupedSelect", async () => {
    execute.mockResolvedValueOnce([[row()], []]);

    await readPlanningRows(fakeConnection(connection), ["m:1", "m:2", "m:1"]);

    expect(execute.mock.calls[0][1]).toEqual(["m:1", "m:2"]);
  });
});

describe("snapshotGesture", () => {
  it("snapshotGesture_onlyWrittenAndRemovedRows_keysDeduped", async () => {
    const written = row({ user_id: 3, source: "MANUAL" });
    const removed = row({ user_id: 7 });
    const untouched = row({ user_id: 8, role: "CASTER" });
    execute.mockResolvedValueOnce([[written, removed, untouched], []]);

    const actual = await snapshotGesture(
      fakeConnection(connection),
      ["m:1"],
      { entryKey: "m:1", userId: 3, role: "REFEREE" },
      (candidate) => candidate.role === "REFEREE" && candidate.user_id !== 3,
    );

    expect(actual).toEqual({
      keys: [
        { entryKey: "m:1", userId: 3, role: "REFEREE" },
        { entryKey: "m:1", userId: 7, role: "REFEREE" },
      ],
      rows: [written, removed],
    });
  });

  it("snapshotGesture_writtenKeyAbsent_stillUndoneByKey", async () => {
    execute.mockResolvedValueOnce([[row({ user_id: 8, role: "CASTER" })], []]);

    const actual = await snapshotGesture(fakeConnection(connection), ["m:1"], { entryKey: "m:1", userId: 3, role: "REFEREE" });

    expect(actual).toEqual({ keys: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }], rows: [] });
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
  it("undoPlanningBlock_keyedDeleteOnly_noEntryWideDelete", async () => {
    const undo: PlanningUndo = {
      keys: [
        { entryKey: "m:1", userId: 3, role: "REFEREE" },
        { entryKey: "m:2", userId: 3, role: "CASTER" },
      ],
      rows: [],
    };

    await undoPlanningBlock(undo, []);

    expect(callsWith("DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ?").map(([, params]) => params)).toEqual([
      ["m:1", 3, "REFEREE"],
      ["m:2", 3, "CASTER"],
    ]);
    expect(callsWith("entry_key IN")).toEqual([]);
  });

  it("undoPlanningBlock_restoreSkipsErasedAccounts", async () => {
    const actual = await undoPlanningBlock({ keys: [{ entryKey: "m:1", userId: 7, role: "REFEREE" }], rows: [row()] }, [77]);

    expect(actual).toBe(true);
    const [restore] = callsWith("INSERT IGNORE INTO bg_planning_assignments");
    expect(restore[0]).toContain("u.is_deleted = 0");
    expect(restore[0]).toContain("b.is_deleted = 0");
    expect(restore[1]).toEqual(["m:1", "REFEREE", 10, 1, "AUTO", "LOAD", 0, 9, CREATED_AT, 7]);
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([77]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("undoPlanningBlock_writeFails_loggedReturnsFalse", async () => {
    execute.mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    const actual = await undoPlanningBlock(UNDO, [77]);

    expect(actual).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("settleFailedDesignation", () => {
  it("settleFailedDesignation_designationTook_nothingUndone", async () => {
    execute.mockResolvedValueOnce([[{ referee_user_id: 3 }], []]);

    await settleFailedDesignation(new Error("PUBLISH_FAILED"), 1, 3, UNDO, [77]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  it("settleFailedDesignation_uncertain_loggedNothingUndone", async () => {
    execute.mockRejectedValueOnce(new Error("ECONNRESET"));

    await settleFailedDesignation(new Error("ER_LOCK_DEADLOCK"), 1, 3, UNDO, [77]);

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("settleFailedDesignation_refused_undone", async () => {
    await settleFailedDesignation(new Error("REFEREE_CHANGED"), 1, 3, UNDO, [77]);

    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([77]);
  });
});
