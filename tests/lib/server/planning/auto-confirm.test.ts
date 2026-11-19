import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn() }));
jest.mock("@/lib/server/named-lock", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock");
  return { ...actual, withNamedLock: jest.fn() };
});
jest.mock("@/lib/server/planning/auto-assign", () => ({ runAutoAssign: jest.fn(), confirmAssignments: jest.fn() }));
jest.mock("@/lib/server/planning/load", () => ({ loadDurationSettings: jest.fn(), loadPlanningEntries: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import {
  AUTO_CONFIRM_LOCK,
  autoConfirmAwaiting,
  countPendingRoles,
  leftoverRoles,
  dueAutoConfirms,
  FAILED_WEEK_RETRY_MS,
  groupByWeek,
  parsePendingRoles,
  reopenedEntries,
  sweepAutoConfirms,
  type AutoConfirmMarks,
} from "@/lib/server/planning/auto-confirm";
import { confirmAssignments, runAutoAssign } from "@/lib/server/planning/auto-assign";
import { loadDurationSettings, loadPlanningEntries } from "@/lib/server/planning/load";
import { DEFAULT_PLANNING_DURATIONS } from "@/lib/shared/planning-durations";
import { HOUR_MS, MONDAY, loadedEntry } from "../../../helpers/planning";
import { connectionMock, fakeConnection, fakePool } from "../../../helpers/sql-double";

/**
 * Confirmation d'office du planning (`docs/features/SCHEDULE_DEADLINE.md`
 * § Planning) : à `min(date butoir, début − délai)`, semaine par semaine,
 * une seule fois par entrée.
 */

const WEEK_MS = 7 * 24 * HOUR_MS;
/** Mercredi de la semaine de `MONDAY`, 21:00 à Paris. */
const WEDNESDAY_21 = MONDAY + (2 * 24 + 21) * HOUR_MS;

/** Aucune marque de confirmation d'office. */
const NO_MARKS: AutoConfirmMarks = { startAt: new Map(), reopened: new Set() };

let connection: ReturnType<typeof connectionMock>;

beforeEach(() => {
  jest.clearAllMocks();
  delete (globalThis as typeof globalThis & { __bgPlanningAutoConfirmRetry?: Map<number, number> }).__bgPlanningAutoConfirmRetry;
  connection = connectionMock();
  connection.execute.mockImplementation(async (sql) => (sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []]));
  jest.mocked(getDatabase).mockResolvedValue(fakePool({}));
  jest.mocked(withNamedLock).mockImplementation(async (_db, _name, _timeout, run) => run(fakeConnection(connection)));
  jest.mocked(loadDurationSettings).mockResolvedValue(DEFAULT_PLANNING_DURATIONS);
  jest.mocked(runAutoAssign).mockResolvedValue({ entries: 0, proposed: 0, replaced: 0 });
  jest.mocked(confirmAssignments).mockResolvedValue({ confirmed: 0, refused: 0 });
});

function insertedKeys(): unknown[] {
  return connection.execute.mock.calls
    .filter(([sql]) => sql.startsWith("INSERT INTO bg_planning_auto_confirms"))
    .map(([, params]) => (params as unknown[])[0]);
}

describe("dueAutoConfirms", () => {
  it("dueAutoConfirms_leadReached_returnsEntry", () => {
    const entry = loadedEntry({ startAt: WEDNESDAY_21 });

    expect(dueAutoConfirms([entry], NO_MARKS, 24, WEDNESDAY_21 - 24 * HOUR_MS)).toEqual([entry]);
  });

  it("dueAutoConfirms_leadNotReached_returnsNothing", () => {
    const entry = loadedEntry({ startAt: WEDNESDAY_21 });

    expect(dueAutoConfirms([entry], NO_MARKS, 24, WEDNESDAY_21 - 24 * HOUR_MS - 1)).toEqual([]);
  });

  it("dueAutoConfirms_deadlineBeforeLead_confirmsAtDeadline", () => {
    // Cas du lundi soir : date butoir lundi 21:00, avant « début − 24 h » (mardi 21:00).
    const entry = loadedEntry({ startAt: WEDNESDAY_21, deadlineAt: MONDAY + 21 * HOUR_MS });

    expect(dueAutoConfirms([entry], NO_MARKS, 24, MONDAY + 21 * HOUR_MS)).toEqual([entry]);
    expect(dueAutoConfirms([entry], NO_MARKS, 24, MONDAY + 21 * HOUR_MS - 1)).toEqual([]);
  });

  it("dueAutoConfirms_leadBeforeDeadline_confirmsAtLead", () => {
    const entry = loadedEntry({ startAt: WEDNESDAY_21, deadlineAt: WEDNESDAY_21 - HOUR_MS });

    expect(dueAutoConfirms([entry], NO_MARKS, 48, WEDNESDAY_21 - 48 * HOUR_MS)).toEqual([entry]);
  });

  it("dueAutoConfirms_closedEntry_skipped", () => {
    expect(dueAutoConfirms([loadedEntry({ open: false })], NO_MARKS, 24, MONDAY)).toEqual([]);
  });

  it("dueAutoConfirms_markedForSameStart_skipped", () => {
    const entry = loadedEntry({ key: "m:1" });
    const marks: AutoConfirmMarks = { startAt: new Map([["m:1", entry.startAt]]), reopened: new Set() };

    expect(dueAutoConfirms([entry], marks, 24, entry.startAt)).toEqual([]);
  });

  it("dueAutoConfirms_markedForOtherStart_due", () => {
    // Match reprogrammé après sa confirmation d'office : il se confirme de nouveau.
    const entry = loadedEntry({ key: "m:1" });
    const marks: AutoConfirmMarks = { startAt: new Map([["m:1", entry.startAt - 24 * HOUR_MS]]), reopened: new Set() };

    expect(dueAutoConfirms([entry], marks, 24, entry.startAt)).toEqual([entry]);
  });

  it("dueAutoConfirms_markedButProposalArrivedSince_due", () => {
    const entry = loadedEntry({ key: "m:1" });
    const marks: AutoConfirmMarks = { startAt: new Map([["m:1", entry.startAt]]), reopened: new Set(["m:1"]) };

    expect(dueAutoConfirms([entry], marks, 24, entry.startAt)).toEqual([entry]);
  });
});

describe("parsePendingRoles", () => {
  it("parsePendingRoles_null_empty", () => {
    expect(parsePendingRoles(null)).toEqual({});
  });

  it("parsePendingRoles_unreadable_empty", () => {
    expect(parsePendingRoles("{pas du json")).toEqual({});
  });

  it("parsePendingRoles_array_empty", () => {
    expect(parsePendingRoles("[1]")).toEqual({});
  });

  it("parsePendingRoles_counts_keepsPositiveIntegersOnly", () => {
    expect(parsePendingRoles('{"CASTER":2,"REFEREE":0,"PROD":1.5,"X":"1"}')).toEqual({ CASTER: 2 });
  });
});

describe("reopenedEntries", () => {
  it("reopenedEntries_moreProvisionalThanAtMark_reopened", () => {
    const stored = new Map([["m:1", { CASTER: 1 }]]);

    expect(reopenedEntries(stored, new Map([["m:1", { CASTER: 2 }]]))).toEqual(new Set(["m:1"]));
  });

  it("reopenedEntries_newRole_reopened", () => {
    expect(reopenedEntries(new Map([["m:1", {}]]), new Map([["m:1", { REFEREE: 1 }]]))).toEqual(new Set(["m:1"]));
  });

  it("reopenedEntries_leftoverRecreatedSameCount_notReopened", () => {
    const stored = new Map([["m:1", { REFEREE: 1 }]]);

    expect(reopenedEntries(stored, new Map([["m:1", { REFEREE: 1 }]]))).toEqual(new Set());
  });

  it("reopenedEntries_unmarkedEntry_ignored", () => {
    expect(reopenedEntries(new Map(), new Map([["m:1", { CASTER: 1 }]]))).toEqual(new Set());
  });
});

describe("groupByWeek", () => {
  it("groupByWeek_twoWeeks_groupsInOrderWithBounds", () => {
    const later = loadedEntry({ key: "m:3", startAt: MONDAY + WEEK_MS + HOUR_MS });
    const first = loadedEntry({ key: "m:1", startAt: MONDAY + HOUR_MS });
    const second = loadedEntry({ key: "m:2", startAt: WEDNESDAY_21 });

    expect(groupByWeek([later, first, second])).toEqual([
      { from: MONDAY, to: MONDAY + WEEK_MS, keys: ["m:1", "m:2"] },
      { from: MONDAY + WEEK_MS, to: MONDAY + 2 * WEEK_MS, keys: ["m:3"] },
    ]);
  });

  it("groupByWeek_empty_returnsEmpty", () => {
    expect(groupByWeek([])).toEqual([]);
  });
});

describe("sweepAutoConfirms", () => {
  const NOW = WEDNESDAY_21 - 24 * HOUR_MS;

  it("sweepAutoConfirms_dueEntry_reassignsWeekThenConfirmsOnlyDueKeysThenMarks", async () => {
    const due = loadedEntry({ key: "m:1", matchId: 1, startAt: WEDNESDAY_21 });
    const notDue = loadedEntry({ key: "m:2", matchId: 2, startAt: WEDNESDAY_21 + 24 * HOUR_MS });
    jest.mocked(loadPlanningEntries).mockResolvedValue([due, notDue]);

    const confirmed = await sweepAutoConfirms(NOW);

    expect(confirmed).toBe(1);
    expect(jest.mocked(withNamedLock).mock.calls[0].slice(1, 3)).toEqual([AUTO_CONFIRM_LOCK, 0]);
    expect(jest.mocked(runAutoAssign)).toHaveBeenCalledWith(null, { from: MONDAY, to: MONDAY + WEEK_MS }, NOW);
    expect(jest.mocked(confirmAssignments)).toHaveBeenCalledWith(null, { entryKeys: ["m:1"] }, NOW);
    expect(jest.mocked(runAutoAssign).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(confirmAssignments).mock.invocationCallOrder[0],
    );
    expect(insertedKeys()).toEqual(["m:1"]);
  });

  it("sweepAutoConfirms_dueEntry_markStoresConfirmedStart", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", matchId: 1, tournamentId: 10, startAt: WEDNESDAY_21 })]);

    await sweepAutoConfirms(NOW);

    const [sql, params] = connection.execute.mock.calls.filter(([text]) => text.startsWith("INSERT INTO bg_planning_auto_confirms"))[0];
    expect(sql).toContain("ON DUPLICATE KEY UPDATE start_at = VALUES(start_at)");
    expect(params).toEqual(["m:1", 10, 1, new Date(WEDNESDAY_21), "{}"]);
  });

  it("sweepAutoConfirms_dueEntry_marksOnlyWhatConfirmationLeftProvisional", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", matchId: 1, tournamentId: 10, startAt: WEDNESDAY_21 })]);
    let confirmed = false;
    jest.mocked(confirmAssignments).mockImplementation(async () => {
      confirmed = true;
      return { confirmed: 1, refused: 0 };
    });
    const referee = { entry_key: "m:1", user_id: 1, role: "REFEREE" };
    const caster = { entry_key: "m:1", user_id: 2, role: "CASTER" };
    connection.execute.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT entry_key, user_id, role")) return [confirmed ? [referee] : [referee, caster], []];
      return sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []];
    });

    await sweepAutoConfirms(NOW);

    const mark = connection.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO bg_planning_auto_confirms"));
    expect(mark?.[1]).toEqual(["m:1", 10, 1, new Date(WEDNESDAY_21), '{"REFEREE":1}']);
  });

  it("sweepAutoConfirms_proposalAddedDuringConfirmation_notInMark", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", matchId: 1, tournamentId: 10, startAt: WEDNESDAY_21 })]);
    let confirmed = false;
    jest.mocked(confirmAssignments).mockImplementation(async () => {
      confirmed = true;
      return { confirmed: 1, refused: 0 };
    });
    connection.execute.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT entry_key, user_id, role")) {
        return [confirmed ? [{ entry_key: "m:1", user_id: 9, role: "CASTER" }] : [{ entry_key: "m:1", user_id: 2, role: "CASTER" }], []];
      }
      return sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []];
    });

    await sweepAutoConfirms(NOW);

    const mark = connection.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO bg_planning_auto_confirms"));
    expect(mark?.[1]).toEqual(["m:1", 10, 1, new Date(WEDNESDAY_21), "{}"]);
  });

  it("sweepAutoConfirms_markedWithMoreProvisionalSince_confirmedAgain", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", startAt: WEDNESDAY_21 })]);
    connection.execute.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT entry_key, start_at")) return [[{ entry_key: "m:1", start_at: new Date(WEDNESDAY_21), pending_roles: '{"REFEREE":1}' }], []];
      if (sql.startsWith("SELECT entry_key, user_id, role")) return [[{ entry_key: "m:1", user_id: 1, role: "REFEREE" }, { entry_key: "m:1", user_id: 2, role: "CASTER" }], []];
      return sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []];
    });

    expect(await sweepAutoConfirms(NOW)).toBe(1);
    expect(jest.mocked(confirmAssignments)).toHaveBeenCalledWith(null, { entryKeys: ["m:1"] }, NOW);
  });

  it("sweepAutoConfirms_markedLeftoverOnly_notConfirmedAgain", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", startAt: WEDNESDAY_21 })]);
    connection.execute.mockImplementation(async (sql) => {
      if (sql.startsWith("SELECT entry_key, start_at")) return [[{ entry_key: "m:1", start_at: new Date(WEDNESDAY_21), pending_roles: '{"REFEREE":1}' }], []];
      if (sql.startsWith("SELECT entry_key, user_id, role")) return [[{ entry_key: "m:1", user_id: 1, role: "REFEREE" }], []];
      return sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []];
    });

    expect(await sweepAutoConfirms(NOW)).toBe(0);
    expect(jest.mocked(runAutoAssign)).not.toHaveBeenCalled();
  });

  it("sweepAutoConfirms_weekFailed_skippedUntilRetryDelay", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", startAt: WEDNESDAY_21 })]);
    jest.mocked(confirmAssignments).mockRejectedValueOnce(new Error("planning occupé"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await sweepAutoConfirms(NOW);

    await sweepAutoConfirms(NOW + FAILED_WEEK_RETRY_MS - 1);

    expect(jest.mocked(runAutoAssign)).toHaveBeenCalledTimes(1);
  });

  it("sweepAutoConfirms_weekFailed_retriedAfterDelay", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", startAt: WEDNESDAY_21 })]);
    jest.mocked(confirmAssignments).mockRejectedValueOnce(new Error("planning occupé"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await sweepAutoConfirms(NOW);

    await expect(sweepAutoConfirms(NOW + FAILED_WEEK_RETRY_MS)).resolves.toBe(1);
    expect(jest.mocked(runAutoAssign)).toHaveBeenCalledTimes(2);
  });

  it("sweepAutoConfirms_alreadyMarked_doesNothing", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "m:1", startAt: WEDNESDAY_21 })]);
    connection.execute.mockImplementation(async (sql) =>
      sql.startsWith("SELECT entry_key, start_at") ? [[{ entry_key: "m:1", start_at: new Date(WEDNESDAY_21) }], []] : sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []],
    );

    expect(await sweepAutoConfirms(NOW)).toBe(0);
    expect(jest.mocked(confirmAssignments)).not.toHaveBeenCalled();
    expect(insertedKeys()).toEqual([]);
  });

  it("sweepAutoConfirms_noOpenEntry_skipsMarkerLookup", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ open: false })]);

    expect(await sweepAutoConfirms(NOW)).toBe(0);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("sweepAutoConfirms_oneWeekFails_otherWeekStillConfirmedAndFailedOneUnmarked", async () => {
    const early = loadedEntry({ key: "m:1", matchId: 1, startAt: WEDNESDAY_21 });
    const late = loadedEntry({ key: "m:2", matchId: 2, startAt: WEDNESDAY_21 + WEEK_MS, deadlineAt: NOW });
    jest.mocked(loadPlanningEntries).mockResolvedValue([early, late]);
    jest.mocked(confirmAssignments).mockRejectedValueOnce(new Error("planning occupé"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const confirmed = await sweepAutoConfirms(NOW);

    expect(confirmed).toBe(1);
    expect(jest.mocked(confirmAssignments)).toHaveBeenCalledTimes(2);
    expect(insertedKeys()).toEqual(["m:2"]);
  });

  it("sweepAutoConfirms_lockHeldElsewhere_returnsZero", async () => {
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError(AUTO_CONFIRM_LOCK, 0));

    expect(await sweepAutoConfirms(NOW)).toBe(0);
    expect(jest.mocked(runAutoAssign)).not.toHaveBeenCalled();
  });

  it("sweepAutoConfirms_otherFailure_rethrows", async () => {
    jest.mocked(withNamedLock).mockRejectedValue(new Error("base injoignable"));

    await expect(sweepAutoConfirms(NOW)).rejects.toThrow("base injoignable");
  });
});

describe("countPendingRoles", () => {
  it("countPendingRoles_proposals_countedPerEntryAndRole", () => {
    const proposals = [
      { entryKey: "m:1", userId: 1, role: "CASTER" },
      { entryKey: "m:1", userId: 2, role: "CASTER" },
      { entryKey: "m:2", userId: 1, role: "REFEREE" },
    ];
    expect(countPendingRoles(proposals)).toEqual(new Map([["m:1", { CASTER: 2 }], ["m:2", { REFEREE: 1 }]]));
  });
});

describe("leftoverRoles", () => {
  it("leftoverRoles_allConfirmed_noLeftover", () => {
    expect(leftoverRoles([{ entryKey: "m:1", userId: 1, role: "CASTER" }], [])).toEqual(new Map());
  });

  it("leftoverRoles_unconfirmedProposal_counted", () => {
    const before = [{ entryKey: "m:1", userId: 1, role: "REFEREE" }];
    expect(leftoverRoles(before, before)).toEqual(new Map([["m:1", { REFEREE: 1 }]]));
  });

  it("leftoverRoles_proposalArrivedDuringConfirmation_notCounted", () => {
    const after = [{ entryKey: "m:1", userId: 9, role: "CASTER" }];
    expect(leftoverRoles([{ entryKey: "m:1", userId: 1, role: "CASTER" }], after)).toEqual(new Map());
  });

  it("leftoverRoles_casterConfirmedThenReplaced_newProposalReopensEntry", () => {
    // Confirmation réussie : rien à la marque ; un caster proposé ensuite rouvre l'entrée.
    const leftover = leftoverRoles([{ entryKey: "m:1", userId: 1, role: "CASTER" }], []);
    const stored = new Map([["m:1", leftover.get("m:1") ?? {}]]);
    expect(reopenedEntries(stored, new Map([["m:1", { CASTER: 1 }]]))).toEqual(new Set(["m:1"]));
  });
});

describe("autoConfirmAwaiting", () => {
  const START = MONDAY + 48 * HOUR_MS;

  it("autoConfirmAwaiting_nothingProvisional_false", () => {
    expect(autoConfirmAwaiting(START, {}, undefined)).toBe(false);
  });

  it("autoConfirmAwaiting_provisionalUnmarked_true", () => {
    expect(autoConfirmAwaiting(START, { CASTER: 1 }, undefined)).toBe(true);
  });

  it("autoConfirmAwaiting_markForOtherStart_true", () => {
    expect(autoConfirmAwaiting(START, { CASTER: 1 }, { startAt: START - HOUR_MS, pending: { CASTER: 1 } })).toBe(true);
  });

  it("autoConfirmAwaiting_leftoverAlreadyAttempted_false", () => {
    expect(autoConfirmAwaiting(START, { REFEREE: 1 }, { startAt: START, pending: { REFEREE: 1 } })).toBe(false);
  });

  it("autoConfirmAwaiting_moreThanAtMark_true", () => {
    expect(autoConfirmAwaiting(START, { REFEREE: 1, CASTER: 1 }, { startAt: START, pending: { REFEREE: 1 } })).toBe(true);
  });
});
