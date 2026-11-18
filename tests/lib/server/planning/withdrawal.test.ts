import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () => ({
  ...jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock"),
  withNamedLock: jest.fn(),
}));
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningData: jest.fn(),
  loadPlanningHistory: jest.fn(),
  loadPlanningMembersByIds: jest.fn(),
  loadHiddenTournamentIds: jest.fn(),
}));
jest.mock("@/lib/server/planning/players", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/players")>("@/lib/server/planning/players"),
  loadEntryPlayers: jest.fn(),
}));
jest.mock("@/lib/server/planning/planning-undo", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/planning-undo")>("@/lib/server/planning/planning-undo"),
  snapshotGesture: jest.fn(),
  readMatchReferee: jest.fn(),
  settleFailedDesignation: jest.fn(),
}));
jest.mock("@/lib/server/planning/notices");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/cast-eligibility");

import type { PoolConnection } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { withNamedLock } from "@/lib/server/named-lock";
import {
  loadHiddenTournamentIds,
  loadPlanningData,
  loadPlanningHistory,
  loadPlanningMembersByIds,
} from "@/lib/server/planning/load";
import { announceWithdrawal } from "@/lib/server/planning/notices";
import { loadEntryPlayers } from "@/lib/server/planning/players";
import { readMatchReferee, settleFailedDesignation, snapshotGesture } from "@/lib/server/planning/planning-undo";
import {
  cleanWithdrawalReason,
  isLateWithdrawal,
  LATE_WITHDRAWAL_MS,
  WITHDRAWAL_REASON_MAX,
  withdrawFromEntry,
} from "@/lib/server/planning/withdrawal";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { authUser } from "../../../helpers/auth-user";
import { available, HOUR_MS, loadedAssignment, loadedEntry, loadedMember, MONDAY, planningData } from "../../../helpers/planning";
import { connectionMock, fakeConnection, fakePool } from "../../../helpers/sql-double";

/** Désistement et remplacement automatique (`CAST_PLANNING.md` § Désistement). */

const connection = connectionMock();
const { execute } = connection;
const caster = authUser({ id: 4, roles: ["CASTER"] });
const referee = authUser({ id: 3, roles: ["ARBITRE"] });
/** Deux jours avant le début : pas tardif. */
const EARLY = MONDAY - 48 * HOUR_MS;

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockImplementation(async (sql: string) =>
    sql.includes("INSERT INTO bg_planning_events") ? [{ affectedRows: 1, insertId: 41 }] : [{ affectedRows: 1 }],
  );
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({}));
  jest.mocked(withNamedLock).mockImplementation(<T>(_pool: unknown, _name: string, _seconds: number, run: (c: PoolConnection) => Promise<T>) =>
    run(fakeConnection(connection)),
  );
  jest.mocked(loadPlanningHistory).mockResolvedValue(new Map());
  jest.mocked(loadEntryPlayers).mockResolvedValue(new Map());
  jest.mocked(loadEligibleRefereeIds).mockImplementation(async (_executor, ids) => new Set(ids));
  jest.mocked(loadPlanningMembersByIds).mockImplementation(async (_executor, ids) =>
    ids.map((userId) => loadedMember({ userId, roles: ["REFEREE", "CASTER", "PROD"], seesHidden: true })),
  );
  jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set());
  jest.mocked(assignMatchReferee).mockResolvedValue(undefined);
  jest.mocked(snapshotGesture).mockResolvedValue({ keys: [], rows: [] });
  jest.mocked(readMatchReferee).mockResolvedValue(3);
  jest.mocked(announceWithdrawal).mockResolvedValue(undefined);
});

/** Avant le désistement : le caster 4 tient sa ligne ; après : elle est partie, et lui écarté (candidats autonomes : sans prod). */
function casterData(options: { confirmed: boolean; candidates?: number[] }) {
  const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), ...(options.candidates ?? []).map((userId) => loadedMember({ userId, roles: ["CASTER"], soloCaster: true }))];
  const availability = (options.candidates ?? []).map((userId) => available("m:1", userId, "CASTER"));
  jest
    .mocked(loadPlanningData)
    .mockResolvedValueOnce(
      planningData({
        entries: [loadedEntry()],
        assignments: [loadedAssignment({ userId: 4, role: "CASTER", confirmed: options.confirmed })],
        members,
        availability,
      }),
    )
    .mockResolvedValueOnce(
      planningData({
        entries: [loadedEntry()],
        members,
        availability,
        removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
      }),
    );
}

function statements(): string[] {
  return execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim().slice(0, 40));
}

describe("cleanWithdrawalReason", () => {
  it("cleanWithdrawalReason_atMaxLength_keepsText", () => {
    const text = "a".repeat(WITHDRAWAL_REASON_MAX);

    expect(cleanWithdrawalReason(text)).toBe(text);
  });

  it("cleanWithdrawalReason_overMaxLength_returnsUndefined", () => {
    expect(cleanWithdrawalReason("a".repeat(WITHDRAWAL_REASON_MAX + 1))).toBeUndefined();
  });

  it("cleanWithdrawalReason_blank_returnsNull", () => {
    expect(cleanWithdrawalReason("   ")).toBeNull();
  });

  it("cleanWithdrawalReason_absent_returnsNull", () => {
    expect(cleanWithdrawalReason(undefined)).toBeNull();
  });

  it("cleanWithdrawalReason_notAString_returnsUndefined", () => {
    expect(cleanWithdrawalReason(12)).toBeUndefined();
  });
});

describe("isLateWithdrawal", () => {
  it("isLateWithdrawal_exactly24hBefore_notLate", () => {
    expect(isLateWithdrawal(MONDAY, MONDAY - LATE_WITHDRAWAL_MS)).toBe(false);
  });

  it("isLateWithdrawal_justUnder24hBefore_late", () => {
    expect(isLateWithdrawal(MONDAY, MONDAY - LATE_WITHDRAWAL_MS + 1)).toBe(true);
  });
});

describe("withdrawFromEntry — refus", () => {
  it("withdrawFromEntry_unknownEntry_throwsNotFound", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [] }));

    await expect(withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY)).rejects.toThrow(
      "PLANNING_ENTRY_NOT_FOUND",
    );
  });

  it("withdrawFromEntry_entryStarted_throwsClosed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: 4, role: "CASTER", confirmed: true })] }),
    );

    await expect(withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, MONDAY)).rejects.toThrow(
      "PLANNING_WITHDRAWAL_CLOSED",
    );
  });

  it("withdrawFromEntry_entryNotEditable_throwsClosed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ editable: false })] }));

    await expect(withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY)).rejects.toThrow(
      "PLANNING_WITHDRAWAL_CLOSED",
    );
  });

  it("withdrawFromEntry_someoneElsesRow_throwsNotAssigned", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: 8, role: "CASTER", confirmed: true })] }),
    );

    await expect(withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY)).rejects.toThrow(
      "PLANNING_NOT_ASSIGNED",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_castSignup_throwsCastManaged", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], matchCasters: new Map([["m:1", [4]]]) }));

    await expect(withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY)).rejects.toThrow(
      "PLANNING_CAST_MANAGED",
    );
  });
});

describe("withdrawFromEntry — désistement et remplacement", () => {
  it("withdrawFromEntry_confirmedWithCandidate_replacementConfirmedAndAnnounced", async () => {
    casterData({ confirmed: true, candidates: [6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: "Malade" }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false });
    expect(statements()).toEqual([
      "DELETE FROM bg_planning_assignments WHER",
      "INSERT INTO bg_planning_events (entry_ke",
      "INSERT INTO bg_planning_assignments (ent",
      "INSERT INTO bg_planning_events (entry_ke",
      "INSERT INTO bg_planning_events (entry_ke",
    ]);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "MANUAL", "Malade", 0]);
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ role: "CASTER", late: false, replacementId: 6 });
  });

  it("withdrawFromEntry_confirmedNoCandidate_unfilledAndAnnounced", async () => {
    casterData({ confirmed: true });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null });
  });

  it("withdrawFromEntry_lessThan24hBefore_flaggedLate", async () => {
    casterData({ confirmed: true });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, MONDAY - HOUR_MS);

    expect(result.late).toBe(true);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "MANUAL", null, 1]);
  });

  it("withdrawFromEntry_provisionalRow_replacementProvisionalWithoutAnnouncement", async () => {
    casterData({ confirmed: false, candidates: [6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false });
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "AUTO", null, 0]);
    expect(execute.mock.calls[2][1]).toEqual(["m:1", 6, "CASTER", 10, 1, "LOAD", 0]);
    expect(announceWithdrawal).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_confirmedMatchReferee_releasedAndReplacedThroughMatch", async () => {
    const members = [loadedMember({ userId: 3 }), loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry({ matchRefereeId: 3 })],
          assignments: [loadedAssignment({ userId: 3, confirmed: true })],
          members,
        }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          members,
          availability: [available("m:1", 5, "REFEREE")],
          removals: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }],
        }),
      );

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    expect(result.replaced).toBe(true);
    expect(jest.mocked(assignMatchReferee).mock.calls).toEqual([
      [1, 3, null, 3],
      [1, 3, 5, null],
    ]);
  });

  it("withdrawFromEntry_matchRefusesRelease_rethrowsAfterUndo", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({ entries: [loadedEntry({ matchRefereeId: 3 })], assignments: [loadedAssignment({ userId: 3, confirmed: true })] }),
    );
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("MATCH_STARTED"));

    await expect(withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY)).rejects.toThrow("MATCH_STARTED");
    expect(jest.mocked(settleFailedDesignation).mock.calls[0][4]).toEqual([41]);
    expect(announceWithdrawal).not.toHaveBeenCalled();
  });
});
