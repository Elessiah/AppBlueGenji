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
jest.mock("@/lib/server/planning/cast-placement", () => ({ placePlannedCasts: jest.fn() }));

import type { PoolConnection } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { withNamedLock } from "@/lib/server/named-lock";
import {
  loadHiddenTournamentIds,
  loadPlanningData,
  loadPlanningHistory,
  loadPlanningMembersByIds,
} from "@/lib/server/planning/load";
import { placePlannedCasts } from "@/lib/server/planning/cast-placement";
import { announceWithdrawal } from "@/lib/server/planning/notices";
import { loadEntryPlayers } from "@/lib/server/planning/players";
import { readMatchReferee, settleFailedDesignation, snapshotGesture } from "@/lib/server/planning/planning-undo";
import { casterHold, casterHolds, cleanWithdrawalReason, isLateWithdrawal, matchGestureFor, pickReplacement, releaseGuestPlanning, withdrawFromEntry } from "@/lib/server/planning/withdrawal";
import { LATE_WITHDRAWAL_MS, WITHDRAWAL_REASON_MAX } from "@/lib/shared/planning";
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
/** `suspended` : candidats qu'une suspension tient (lu avec le compte). */
function casterData(options: { confirmed: boolean; candidates?: number[]; suspended?: number[] }) {
  const members = [
    loadedMember({ userId: 4, roles: ["CASTER"] }),
    ...(options.candidates ?? []).map((userId) =>
      loadedMember({ userId, roles: ["CASTER"], soloCaster: true, suspended: options.suspended?.includes(userId) ?? false }),
    ),
  ];
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

  it("withdrawFromEntry_impersonatingCasterOnRefereeSlot_throwsPlayerViewActiveWithoutLock", async () => {
    const impersonatingCaster = authUser({ id: 3, isAdmin: false, roles: ["CASTER"], playerView: true, playerViewAvailable: true });

    await expect(withdrawFromEntry(impersonatingCaster, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY)).rejects.toThrow(
      "PLAYER_VIEW_ACTIVE",
    );
    expect(withNamedLock).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_impersonatingProdOnProdSlot_passesTheImpersonationGuard", async () => {
    const impersonatingProd = authUser({ id: 4, isAdmin: false, roles: ["PROD"], playerView: true, playerViewAvailable: true });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [] }));

    await expect(withdrawFromEntry(impersonatingProd, { entryKey: "m:1", role: "PROD", reason: null }, EARLY)).rejects.toThrow(
      "PLANNING_ENTRY_NOT_FOUND",
    );
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

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(statements()).toEqual([
      "DELETE FROM bg_planning_assignments WHER",
      "INSERT INTO bg_planning_events (entry_ke",
      "INSERT INTO bg_planning_assignments (ent",
      "INSERT INTO bg_planning_events (entry_ke",
      "INSERT INTO bg_planning_events (entry_ke",
    ]);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "MANUAL", null, "Malade", 0, 0]);
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ role: "CASTER", late: false, replacementId: 6 });
  });

  it("withdrawFromEntry_confirmedReplacement_placedOnMatchWithoutActor", async () => {
    casterData({ confirmed: true, candidates: [6] });

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(jest.mocked(placePlannedCasts).mock.calls[0][0]).toMatchObject([{ userId: 6, role: "CASTER", entry: { key: "m:1" } }]);
    expect(jest.mocked(placePlannedCasts).mock.calls[0][1]).toBeNull();
  });

  it("withdrawFromEntry_confirmedNoReplacement_notPlaced", async () => {
    casterData({ confirmed: true });

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(placePlannedCasts).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_provisionalReplacement_notPlaced", async () => {
    casterData({ confirmed: false, candidates: [6] });

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(placePlannedCasts).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_memberWithdrawal_notReleasedNoActor", async () => {
    casterData({ confirmed: true, candidates: [6] });

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    const announced = jest.mocked(announceWithdrawal).mock.calls[0][0];
    expect(announced.released).toBeUndefined();
    expect(announced.actorId).toBeUndefined();
  });

  it("withdrawFromEntry_confirmedNoCandidate_unfilledAndAnnounced", async () => {
    casterData({ confirmed: true });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, unfilled: true, withdrawnUserId: 4 });
  });

  it("withdrawFromEntry_onlyCandidateSuspended_slotUnfilled", async () => {
    casterData({ confirmed: true, candidates: [6], suspended: [6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, unfilled: true });
  });

  it("withdrawFromEntry_twoActiveCandidates_firstPicked", async () => {
    casterData({ confirmed: true, candidates: [6, 7] });

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 6 });
  });

  it("withdrawFromEntry_candidateSuspendedUnderLock_notPlaced", async () => {
    casterData({ confirmed: true, candidates: [6] });
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 6, roles: ["CASTER"], suspended: true })]);

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(statements()).not.toContain("INSERT INTO bg_planning_assignments (ent");
  });

  it("withdrawFromEntry_suspendedAndActiveCandidates_activeReplacementPicked", async () => {
    casterData({ confirmed: true, candidates: [6, 7], suspended: [6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 7 });
  });

  it("withdrawFromEntry_lessThan24hBefore_flaggedLate", async () => {
    casterData({ confirmed: true });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, MONDAY - HOUR_MS);

    expect(result.late).toBe(true);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "MANUAL", null, null, 1, 0]);
  });

  it("withdrawFromEntry_provisionalRow_replacementProvisionalWithoutAnnouncement", async () => {
    casterData({ confirmed: false, candidates: [6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "AUTO", null, null, 0, 0]);
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
      [1, 3, null, 3, { guestRelease: false }],
      [1, 3, 5, null, { refuseSuspended: true, guestRelease: false }],
    ]);
  });

  it("withdrawFromEntry_refereeReplacementUnavailable_slotUnfilledNoRow", async () => {
    const members = [loadedMember({ userId: 3 }), loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry({ matchRefereeId: 3 })], assignments: [loadedAssignment({ userId: 3, confirmed: true })], members }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          members,
          availability: [available("m:1", 5, "REFEREE")],
          removals: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }],
        }),
      );
    jest.mocked(assignMatchReferee).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("REFEREE_UNAVAILABLE"));

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(assignMatchReferee).mock.calls[1]).toEqual([1, 3, 5, null, { refuseSuspended: true, guestRelease: false }]);
    expect(loadPlanningMembersByIds).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_matchRefereeChangedMeanwhile_noReplacementNorOpenSlot", async () => {
    // Le staff a posé l'arbitre 7 sur le match entre la lecture et le retrait : la place est tenue.
    // Les co-affectés se lisent dans la lecture déjà faite, sans recharger tout le planning.
    const members = [loadedMember({ userId: 3 }), loadedMember({ userId: 5, roles: ["CASTER"] }), loadedMember({ userId: 7 })];
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({
        entries: [loadedEntry({ matchRefereeId: 3 })],
        assignments: [loadedAssignment({ userId: 3, confirmed: true }), loadedAssignment({ userId: 5, role: "CASTER", confirmed: true })],
        members,
      }),
    );
    jest.mocked(readMatchReferee).mockResolvedValue(7);

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(loadPlanningData).toHaveBeenCalledTimes(1);
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, unfilled: false, coAssignedIds: [5] });
  });

  it("withdrawFromEntry_matchRefereeClearedMeanwhile_noReleaseCallButReplacementSearched", async () => {
    const members = [loadedMember({ userId: 3 }), loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry({ matchRefereeId: 3 })], assignments: [loadedAssignment({ userId: 3, confirmed: true })], members }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          members,
          availability: [available("m:1", 5, "REFEREE")],
          removals: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }],
        }),
      );
    jest.mocked(readMatchReferee).mockResolvedValue(null);

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(assignMatchReferee).mock.calls).toEqual([[1, 3, 5, null, { refuseSuspended: true, guestRelease: false }]]);
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

describe("withdrawFromEntry — panne après le désistement", () => {
  /** Le planning refuse la ligne du remplaçant (verrou perdu, interblocage…). */
  function assignmentInsertFails() {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO bg_planning_assignments")) throw new Error("ER_LOCK_DEADLOCK");
      return sql.includes("INSERT INTO bg_planning_events") ? [{ affectedRows: 1, insertId: 41 }] : [{ affectedRows: 1 }];
    });
  }

  /** Arbitre confirmé 3 qui se désiste ; 5 disponible pour le remplacer. */
  function refereeWithCandidate() {
    const members = [loadedMember({ userId: 3 }), loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry({ matchRefereeId: 3 })], assignments: [loadedAssignment({ userId: 3, confirmed: true })], members }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          members,
          availability: [available("m:1", 5, "REFEREE")],
          removals: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }],
        }),
      );
  }

  it("withdrawFromEntry_replacementDesignationOutageButMatchTookIt_replacedAndRowWritten", async () => {
    refereeWithCandidate();
    // Lu vide avant le retrait, puis relu après la panne : la désignation a pris.
    jest.mocked(readMatchReferee).mockResolvedValueOnce(null).mockResolvedValueOnce(5);
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    const row = execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO bg_planning_assignments"));
    expect(row?.[1]).toEqual(expect.arrayContaining(["m:1", 5, "REFEREE", 1]));
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 5, unfilled: false });
  });

  it("withdrawFromEntry_replacementDesignationOutageMatchEmpty_slotUnfilled", async () => {
    refereeWithCandidate();
    jest.mocked(readMatchReferee).mockResolvedValue(null);
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO bg_planning_assignments"))).toBe(false);
    expect(error).toHaveBeenCalledWith("[planning] remplaçant d'arbitre non posé.", expect.anything());
    error.mockRestore();
  });

  it("withdrawFromEntry_replacementSearchFails_withdrawalKeptAndUnfilledAnnounced", async () => {
    casterData({ confirmed: true, candidates: [6] });
    jest.mocked(loadPlanningHistory).mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, unfilled: true, withdrawnUserId: 4 });
    error.mockRestore();
  });

  it("withdrawFromEntry_replacementRowFails_slotUnfilledAndAnnounced", async () => {
    casterData({ confirmed: true, candidates: [6] });
    assignmentInsertFails();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, unfilled: true });
    error.mockRestore();
  });

  it("withdrawFromEntry_refereeRowFailsAfterMatchSet_replacementKeptAndAnnounced", async () => {
    const members = [loadedMember({ userId: 3 }), loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry({ matchRefereeId: 3 })], assignments: [loadedAssignment({ userId: 3, confirmed: true })], members }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          members,
          availability: [available("m:1", 5, "REFEREE")],
          removals: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }],
        }),
      );
    assignmentInsertFails();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await withdrawFromEntry(referee, { entryKey: "m:1", role: "REFEREE", reason: null }, EARLY);

    // Le match porte déjà l'arbitre 5 : il tient le rôle, la réconciliation écrira sa ligne.
    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 5, unfilled: false });
    error.mockRestore();
  });
});

/**
 * Deux casters confirmés (4 et 5) ; 4 se désiste. `candidates` : casters libres
 * pour un renfort ; `elsewhere` : une entrée m:2 qui chevauche, sans caster,
 * où ces candidats sont aussi disponibles.
 */
function twoCasterData(options: {
  candidates?: number[];
  elsewhere?: boolean;
  onlySolo?: number;
  soloIds?: number[];
  /** La ligne de 4 (le désisté) n'est qu'une proposition. */
  withdrawnProvisional?: boolean;
  /** Un prod proposé (provisoire) sur m:1. */
  provisionalProd?: number;
}) {
  const candidates = options.candidates ?? [];
  const entries = [loadedEntry(), ...(options.elsewhere ? [loadedEntry({ key: "m:2", matchId: 2 })] : [])];
  const solo = (userId: number) =>
    options.soloIds !== undefined ? options.soloIds.includes(userId) : options.onlySolo === undefined || options.onlySolo === userId;
  const prodIds = options.provisionalProd === undefined ? [] : [options.provisionalProd];
  const members = [
    ...[4, 5, ...candidates].map((userId) => loadedMember({ userId, roles: ["CASTER"], soloCaster: solo(userId) })),
    ...prodIds.map((userId) => loadedMember({ userId, roles: ["PROD"] })),
  ];
  const availability = candidates.flatMap((userId) => [
    available("m:1", userId, "CASTER"),
    ...(options.elsewhere ? [available("m:2", userId, "CASTER")] : []),
  ]);
  const second = loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true });
  const prods = prodIds.map((userId) => loadedAssignment({ userId, role: "PROD", confirmed: false }));
  jest
    .mocked(loadPlanningData)
    .mockResolvedValueOnce(
      planningData({
        entries,
        assignments: [loadedAssignment({ userId: 4, role: "CASTER", confirmed: options.withdrawnProvisional !== true }), second, ...prods],
        members,
        availability,
      }),
    )
    .mockResolvedValueOnce(
      planningData({
        entries,
        assignments: [second, ...prods],
        members,
        availability,
        removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
      }),
    );
}

describe("withdrawFromEntry — deux casters", () => {
  it("withdrawFromEntry_oneOfTwoCastersNoSpare_stillHeldNotUnfilled", async () => {
    twoCasterData({});

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({
      replacementId: null,
      unfilled: false,
      stillHeldBy: [5],
      coAssignedIds: [5],
    });
  });

  it("withdrawFromEntry_oneOfTwoCastersNobodyAvailable_noHistoryRead", async () => {
    twoCasterData({});

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(loadPlanningHistory).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_oneOfTwoCastersSpareAvailable_historyRead", async () => {
    twoCasterData({ candidates: [6] });

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(loadPlanningHistory).toHaveBeenCalledTimes(1);
  });

  it("withdrawFromEntry_oneOfTwoCastersSpareFree_replaced", async () => {
    twoCasterData({ candidates: [6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 6, stillHeldBy: [] });
  });

  it("withdrawFromEntry_spareNeededOnOverlappingEntry_notTaken", async () => {
    twoCasterData({ candidates: [6], elsewhere: true });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(statements()).toEqual(["DELETE FROM bg_planning_assignments WHER", "INSERT INTO bg_planning_events (entry_ke"]);
  });
});

describe("withdrawFromEntry — deux casters, diffusion perdue", () => {
  it("withdrawFromEntry_soloCasterLeavesNonSoloWithoutProd_unfilled", async () => {
    twoCasterData({ onlySolo: 4 });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: true, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ unfilled: true, stillHeldBy: [], streamLost: true });
  });

  it("withdrawFromEntry_streamLostSoloCandidateNeededElsewhere_soloReplacementPicked", async () => {
    // 6, autonome, est aussi attendu sur m:2 (qui chevauche, sans caster) : rendre la diffusion de m:1 passe d'abord.
    twoCasterData({ candidates: [6], elsewhere: true, soloIds: [4, 6] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 6, streamLost: false });
  });

  it("withdrawFromEntry_streamLostOnlyNonSoloCandidate_unfilledStreamLost", async () => {
    // 6 n'est pas autonome : il ne rendrait pas la diffusion.
    twoCasterData({ candidates: [6], soloIds: [4] });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: true, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, streamLost: true });
  });

  it("withdrawFromEntry_provisionalSoloCasterLeavesConfirmedNonSolo_spareRuleKeepsCandidateNeededElsewhere", async () => {
    // 4 (autonome) n'était qu'une proposition : aucune diffusion confirmée perdue ; 6, attendu sur m:2, n'est pas pris.
    twoCasterData({ candidates: [6], elsewhere: true, soloIds: [4, 6], withdrawnProvisional: true });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(announceWithdrawal).not.toHaveBeenCalled();
  });

  it("withdrawFromEntry_streamLostButProdProposed_nonSoloSpareReplaces", async () => {
    // 7 est proposé comme prod auprès de 5 : l'entrée reste diffusée pour le calcul, la règle du renfort s'applique.
    twoCasterData({ candidates: [6], soloIds: [4], provisionalProd: 7 });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 6, streamLost: false });
  });

  it("withdrawFromEntry_secondCasterLeavesStreamKept_streamLostFalse", async () => {
    twoCasterData({});

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ stillHeldBy: [5], streamLost: false });
  });

  it("withdrawFromEntry_streamLostProdProposedSpareNeededElsewhere_soloFallbackPicked", async () => {
    // 7 n'est que proposé : la règle du renfort écarte 6 (attendu sur m:2) ; à défaut, 6, autonome, rend la diffusion.
    twoCasterData({ candidates: [6], elsewhere: true, soloIds: [4, 6], provisionalProd: 7 });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: true, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: 6, streamLost: false });
  });

  it("withdrawFromEntry_streamLostProdProposedNoCandidate_unfilledStreamLost", async () => {
    // La diffusion se juge sur les rôles confirmés : un prod seulement proposé ne la tient pas.
    twoCasterData({ soloIds: [4], provisionalProd: 7 });

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: true, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ replacementId: null, stillHeldBy: [], streamLost: true });
  });
});

describe("withdrawFromEntry — inscriptions de cast entre les deux lectures", () => {
  const withdrawn = loadedAssignment({ userId: 4, role: "CASTER", confirmed: true });

  it("withdrawFromEntry_coCasterCastSignupGoneBeforeReread_unfilled", async () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 5, roles: ["CASTER"] })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], assignments: [withdrawn], matchCasters: new Map([["m:1", [5]]]), members }),
      )
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], members, removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }] }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: true, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ stillHeldBy: [], streamLost: false });
  });

  it("withdrawFromEntry_soloSignupAddedBeforeReread_streamKept", async () => {
    const second = loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true });
    const members = [
      loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true }),
      loadedMember({ userId: 5, roles: ["CASTER"] }),
      loadedMember({ userId: 8, roles: ["CASTER"], soloCaster: true }),
    ];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], assignments: [withdrawn, second], members }))
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          assignments: [second],
          matchCasters: new Map([["m:1", [8]]]),
          members,
          removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
        }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ stillHeldBy: [5, 8], streamLost: false });
  });
});

describe("withdrawFromEntry — désisté encore inscrit sur le match", () => {
  const withdrawn = loadedAssignment({ userId: 4, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true });
  const prod = loadedAssignment({ userId: 7, role: "PROD", source: "MANUAL", reason: "MANUAL", confirmed: true });

  it("withdrawFromEntry_withdrawerSignedUpAloneWithAvailableCandidate_noReplacementSearched", async () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 6, roles: ["CASTER"] })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], assignments: [withdrawn], matchCasters: new Map([["m:1", [4]]]), members }))
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          matchCasters: new Map([["m:1", [4]]]),
          members,
          availability: [available("m:1", 6, "CASTER")],
          removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
        }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: true });
    expect(statements()).not.toContain("INSERT INTO bg_planning_assignments (ent");
  });

  it("withdrawFromEntry_withdrawerStillSignedUpAlone_noMemberAnnouncement", async () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 7, roles: ["PROD"] })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], assignments: [withdrawn, prod], matchCasters: new Map([["m:1", [4]]]), members }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          assignments: [prod],
          matchCasters: new Map([["m:1", [4]]]),
          members,
          removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
        }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: true });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({
      stillHeldBy: [],
      coAssignedIds: [],
      staffUnfilled: null,
    });
  });

  it("withdrawFromEntry_withdrawerSignedUpWithOtherCaster_stillHeldByOthersOnly", async () => {
    const second = loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true });
    const members = [
      loadedMember({ userId: 4, roles: ["CASTER"] }),
      loadedMember({ userId: 5, roles: ["CASTER"] }),
      loadedMember({ userId: 7, roles: ["PROD"] }),
    ];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          assignments: [withdrawn, second, prod],
          matchCasters: new Map([["m:1", [4]]]),
          members,
        }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          assignments: [second, prod],
          matchCasters: new Map([["m:1", [4]]]),
          members,
          removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
        }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    const announced = jest.mocked(announceWithdrawal).mock.calls[0][0];
    expect(announced.stillHeldBy).toEqual([5]);
    expect(announced.coAssignedIds).toEqual([5, 7]);
    expect(announced.staffUnfilled).toBeNull();
  });

  it("withdrawFromEntry_withdrawerSignedUpAloneReReadFails_noMemberAnnouncement", async () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 7, roles: ["PROD"] })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], assignments: [withdrawn, prod], matchCasters: new Map([["m:1", [4]]]), members }),
      )
      .mockRejectedValueOnce(new Error("outage"));

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: true });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({
      stillHeldBy: [],
      coAssignedIds: [],
      staffUnfilled: null,
    });
  });

  it("withdrawFromEntry_suspendedWithdrawerSignedUpAlone_staffAlertedMembersSilent", async () => {
    // Pour le staff, un compte suspendu ne tient rien : la place y est à pourvoir ; les membres n'apprennent rien.
    const members = [loadedMember({ userId: 4, roles: ["CASTER"], suspended: true }), loadedMember({ userId: 7, roles: ["PROD"] })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], assignments: [withdrawn, prod], matchCasters: new Map([["m:1", [4]]]), members }),
      )
      .mockResolvedValueOnce(
        planningData({
          entries: [loadedEntry()],
          assignments: [prod],
          matchCasters: new Map([["m:1", [4]]]),
          members,
          removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }],
        }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: true });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({
      stillHeldBy: [],
      coAssignedIds: [],
      staffUnfilled: { streamLost: false },
    });
  });
});

describe("withdrawFromEntry — autre rôle du désisté", () => {
  it("withdrawFromEntry_casterAlsoRefereeSearchFails_otherRoleStillCoAssigned", async () => {
    // Tournoi entier : 4 y est caster et arbitre ; la recherche échoue, `data` (avant le retrait) porte encore ses deux lignes.
    const entry = loadedEntry({ kind: "TOURNAMENT", key: "t:10", matchId: null, roundNumber: null, team1: null, team2: null });
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({
        entries: [entry],
        assignments: [
          loadedAssignment({ entryKey: "t:10", userId: 4, role: "CASTER", confirmed: true }),
          loadedAssignment({ entryKey: "t:10", userId: 4, role: "REFEREE", confirmed: true }),
        ],
        members: [loadedMember({ userId: 4, roles: ["CASTER", "REFEREE"] })],
      }),
    );
    jest.mocked(loadPlanningData).mockRejectedValueOnce(new Error("outage"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await withdrawFromEntry(caster, { entryKey: "t:10", role: "CASTER", reason: null }, EARLY);

    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ coAssignedIds: [4], unfilled: true });
    error.mockRestore();
  });
});

describe("casterHold", () => {
  it("casterHold_provisionalWithdrawnSolo_streamLostFalse", () => {
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [
        loadedAssignment({ userId: 4, role: "CASTER", confirmed: false }),
        loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true }),
      ],
      members: [loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true }), loadedMember({ userId: 5, roles: ["CASTER"] })],
    });

    const hold = casterHold(data.entries[0], data, { userId: 4, role: "CASTER", source: "AUTO", reason: "LOAD", provisional: true });

    expect(hold).toEqual({ casterIds: [5], selfHeld: false, streamLost: false });
  });

  it("casterHold_provisionalProdKept_streamLostTrue", () => {
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [
        loadedAssignment({ userId: 4, role: "CASTER", confirmed: true }),
        loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true }),
        loadedAssignment({ userId: 7, role: "PROD", confirmed: false }),
      ],
      members: [
        loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 5, roles: ["CASTER"] }),
        loadedMember({ userId: 7, roles: ["PROD"] }),
      ],
    });

    const hold = casterHold(data.entries[0], data, { userId: 4, role: "CASTER", source: "AUTO", reason: "LOAD", provisional: false });

    expect(hold).toEqual({ casterIds: [], selfHeld: false, streamLost: true });
  });
});

describe("pickReplacement — second caster", () => {
  it("pickReplacement_spareWithCasterProdOnlyFree_casterProdPickedAsCaster", () => {
    // 5 (non autonome) reste confirmé, sans prod ; 7, caster et prod, est le seul libre.
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      members: [loadedMember({ userId: 5, roles: ["CASTER"] }), loadedMember({ userId: 7, roles: ["CASTER", "PROD"] })],
      availability: [available("m:1", 7, "CASTER"), available("m:1", 7, "PROD")],
    });

    const pick = pickReplacement(data, data.entries[0], "CASTER", new Map(), new Set(), MONDAY);

    expect(pick).toMatchObject({ entryKey: "m:1", userId: 7, role: "CASTER" });
  });

  it("pickReplacement_onlyProvisionalCoCaster_firstCasterRuleApplied", () => {
    // 5 n'est qu'une proposition : la place quittée est la première ; 6 la prend même si m:2 (qui chevauche) n'a pas de caster.
    const entries = [loadedEntry(), loadedEntry({ key: "m:2", matchId: 2 })];
    const data = planningData({
      entries,
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", confirmed: false })],
      members: [5, 6].map((userId) => loadedMember({ userId, roles: ["CASTER"], soloCaster: true })),
      availability: [available("m:1", 5, "CASTER"), available("m:1", 6, "CASTER"), available("m:2", 6, "CASTER")],
    });

    const pick = pickReplacement(data, entries[0], "CASTER", new Map(), new Set(), MONDAY);

    expect(pick).toMatchObject({ entryKey: "m:1", userId: 6, role: "CASTER" });
  });
});

describe("casterHold — inscription au match et suspension", () => {
  const withdrawn = { userId: 4, role: "CASTER" as const, source: "MANUAL" as const, reason: "MANUAL" as const, provisional: false };

  it("casterHold_withdrawerStillSignedUpOnMatch_keepsCastRowNoStreamLost", () => {
    // Relu après le retrait : la ligne du planning de 4 est partie, son inscription au match reste.
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      matchCasters: new Map([["m:1", [4]]]),
      members: [loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true }), loadedMember({ userId: 5, roles: ["CASTER"] })],
    });

    const hold = casterHold(data.entries[0], data, withdrawn);

    expect(hold).toEqual({ casterIds: [5], selfHeld: true, streamLost: false });
  });

  it("casterHold_preRemovalReadWithdrawerSignedUpOnMatch_keepsWithdrawer", () => {
    // Lecture d'avant le retrait (repli) : la ligne du planning de 4 masque son inscription au match, il cast encore.
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [loadedAssignment({ userId: 4, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      matchCasters: new Map([["m:1", [4]]]),
      members: [loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true })],
    });

    const hold = casterHold(data.entries[0], data, withdrawn);

    expect(hold).toEqual({ casterIds: [], selfHeld: true, streamLost: false });
  });

  it("casterHold_preRemovalReadWithdrawerNotSignedUp_dropsWithdrawer", () => {
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [loadedAssignment({ userId: 4, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      members: [loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true })],
    });

    const hold = casterHold(data.entries[0], data, withdrawn);

    expect(hold).toEqual({ casterIds: [], selfHeld: false, streamLost: false });
  });

  it("casterHolds_remainingSoloCasterSuspended_shownHeldStaffStreamLost", () => {
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      members: [
        loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 5, roles: ["CASTER"], soloCaster: true, suspended: true }),
      ],
    });

    const holds = casterHolds(data.entries[0], data, withdrawn);

    expect(holds).toEqual({ shown: { casterIds: [5], selfHeld: false, streamLost: false }, staff: { casterIds: [], selfHeld: false, streamLost: false } });
  });

  it("casterHolds_suspendedWithdrawerSignedUp_shownSelfHeldStaffNot", () => {
    const data = planningData({
      entries: [loadedEntry()],
      matchCasters: new Map([["m:1", [4]]]),
      members: [loadedMember({ userId: 4, roles: ["CASTER"], suspended: true })],
    });

    const holds = casterHolds(data.entries[0], data, withdrawn);

    expect(holds).toEqual({ shown: { casterIds: [], selfHeld: true, streamLost: false }, staff: { casterIds: [], selfHeld: false, streamLost: false } });
  });

  it("casterHolds_remainingNonSoloCasterSuspended_staffUnheld", () => {
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      members: [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 5, roles: ["CASTER"], suspended: true })],
    });

    const holds = casterHolds(data.entries[0], data, withdrawn);

    expect(holds).toEqual({ shown: { casterIds: [5], selfHeld: false, streamLost: false }, staff: { casterIds: [], selfHeld: false, streamLost: false } });
  });
});

describe("pickReplacement — plafond", () => {
  it("pickReplacement_matchSignupsReachCap_returnsNull", () => {
    const data = planningData({
      entries: [loadedEntry()],
      matchCasters: new Map([["m:1", [5, 8]]]),
      members: [
        loadedMember({ userId: 5, roles: ["CASTER"] }),
        loadedMember({ userId: 6, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 8, roles: ["CASTER"] }),
      ],
      availability: [available("m:1", 6, "CASTER")],
    });

    const pick = pickReplacement(data, data.entries[0], "CASTER", new Map(), new Set(), MONDAY);

    expect(pick).toBeNull();
  });
});

describe("pickReplacement — caster suspendu", () => {
  it("pickReplacement_neighbourHeldOnlyBySuspendedCaster_spareNotTakenFromNeighbour", () => {
    // m:1 garde 5 (confirmé) : renfort. m:2 (qui chevauche) n'est tenu que par 8, suspendu : 6 y est attendu.
    const entries = [loadedEntry(), loadedEntry({ key: "m:2", matchId: 2 })];
    const data = planningData({
      entries,
      assignments: [
        loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true }),
        loadedAssignment({ entryKey: "m:2", userId: 8, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true }),
      ],
      members: [
        loadedMember({ userId: 5, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 6, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 8, roles: ["CASTER"], soloCaster: true, suspended: true }),
      ],
      availability: [available("m:1", 6, "CASTER"), available("m:2", 6, "CASTER")],
    });

    const pick = pickReplacement(data, entries[0], "CASTER", new Map(), new Set(), MONDAY);

    expect(pick).toBeNull();
  });

  it("pickReplacement_onlyCoCasterSuspended_firstCasterRuleApplied", () => {
    // 5, confirmé mais suspendu, ne tient rien : 6 est pris comme premier caster, même attendu sur m:2 (qui chevauche).
    const entries = [loadedEntry(), loadedEntry({ key: "m:2", matchId: 2 })];
    const data = planningData({
      entries,
      assignments: [loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true })],
      members: [
        loadedMember({ userId: 5, roles: ["CASTER"], soloCaster: true, suspended: true }),
        loadedMember({ userId: 6, roles: ["CASTER"], soloCaster: true }),
      ],
      availability: [available("m:1", 6, "CASTER"), available("m:2", 6, "CASTER")],
    });

    const pick = pickReplacement(data, entries[0], "CASTER", new Map(), new Set(), MONDAY);

    expect(pick).toMatchObject({ entryKey: "m:1", userId: 6, role: "CASTER" });
  });

  it("pickReplacement_suspendedCasterFillsCap_noThirdCaster", () => {
    // 5 tient l'entrée ; 8, suspendu, ne tient rien mais sa ligne compte au plafond : aucun troisième caster.
    const data = planningData({
      entries: [loadedEntry()],
      assignments: [
        loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true }),
        loadedAssignment({ userId: 8, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true }),
      ],
      members: [
        loadedMember({ userId: 5, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 6, roles: ["CASTER"], soloCaster: true }),
        loadedMember({ userId: 8, roles: ["CASTER"], soloCaster: true, suspended: true }),
      ],
      availability: [available("m:1", 6, "CASTER")],
    });

    const pick = pickReplacement(data, data.entries[0], "CASTER", new Map(), new Set(), MONDAY);

    expect(pick).toBeNull();
  });
});

describe("withdrawFromEntry — caster restant suspendu", () => {
  it("withdrawFromEntry_remainingCasterSuspended_staffAlertedMembersToldStillHeld", async () => {
    const second = loadedAssignment({ userId: 5, role: "CASTER", source: "MANUAL", reason: "MANUAL", confirmed: true });
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 5, roles: ["CASTER"], suspended: true })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: 4, role: "CASTER", confirmed: true }), second], members }),
      )
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry()], assignments: [second], members, removals: [{ entryKey: "m:1", userId: 4, role: "CASTER" }] }),
      );

    const result = await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(result).toEqual({ late: false, replaced: false, unfilled: false, streamLost: false, stillSignedUp: false });
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({
      unfilled: false,
      stillHeldBy: [5],
      staffUnfilled: { streamLost: false },
    });
  });

  it("withdrawFromEntry_secondCasterLeavesHealthyCoCaster_noStaffAlert", async () => {
    twoCasterData({});

    await withdrawFromEntry(caster, { entryKey: "m:1", role: "CASTER", reason: null }, EARLY);

    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ staffUnfilled: null });
  });
});

describe("releaseGuestPlanning (`CAST_PLANNING.md` § Invités)", () => {
  const GUEST = 4;
  /** Le staff `roles` qui pose le drapeau. */
  const STAFF = 1;

  /** Le compte relu sous le verrou, une ligne par relecture (la dernière se répète) : invité par défaut. */
  let guestReads: { is_guest_staff: number; is_admin: number; is_deleted: number }[];
  /** Disponibilités effacées par la sortie. */
  let availabilityCleared: number;
  const GUEST_ROW = { is_guest_staff: 1, is_admin: 0, is_deleted: 0 };

  beforeEach(() => {
    guestReads = [GUEST_ROW];
    availabilityCleared = 0;
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT is_guest_staff")) return [[guestReads.length > 1 ? guestReads.shift() : guestReads[0]]];
      if (sql.includes("DELETE a FROM bg_planning_availability")) return [{ affectedRows: availabilityCleared }];
      return sql.includes("INSERT INTO bg_planning_events") ? [{ affectedRows: 1, insertId: 41 }] : [{ affectedRows: 1 }];
    });
  });

  function availabilityDeletes() {
    return execute.mock.calls.filter(([sql]) => sql.includes("DELETE a FROM bg_planning_availability"));
  }

  function assignmentDeletes() {
    return execute.mock.calls.filter(([sql]) => sql.includes("DELETE FROM bg_planning_assignments"));
  }

  it("releaseGuestPlanning_listsUnderPlanningLock", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(planningData({ entries: [loadedEntry()] }));

    await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(withNamedLock).toHaveBeenCalledTimes(1);
    expect(jest.mocked(loadPlanningData).mock.calls[0][0]).toBe(connection);
    expect(execute.mock.calls[0][0]).toContain("SELECT is_guest_staff");
  });

  it("releaseGuestPlanning_flagRevokedBeforeListing_returnsZeroNoFailure", async () => {
    guestReads = [{ ...GUEST_ROW, is_guest_staff: 0 }];

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release).toEqual({ withdrawn: 0, failed: 0, availabilityCleared: 0 });
    expect(loadPlanningData).not.toHaveBeenCalled();
    expect(availabilityDeletes()).toHaveLength(0);
  });

  it("releaseGuestPlanning_promotedAdminBeforeListing_returnsZeroNoFailure", async () => {
    guestReads = [{ ...GUEST_ROW, is_admin: 1 }];

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release).toEqual({ withdrawn: 0, failed: 0, availabilityCleared: 0 });
    expect(loadPlanningData).not.toHaveBeenCalled();
  });

  it("releaseGuestPlanning_flagRevokedMidLoop_stopsRemainingWithdrawals", async () => {
    guestReads = [GUEST_ROW, { ...GUEST_ROW, is_guest_staff: 0 }];
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({
        entries: [loadedEntry(), loadedEntry({ key: "m:2", matchId: 2 })],
        assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" }), loadedAssignment({ entryKey: "m:2", userId: GUEST, role: "CASTER" })],
      }),
    );

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release).toEqual({ withdrawn: 0, failed: 0, availabilityCleared: 0 });
    expect(assignmentDeletes()).toHaveLength(0);
    expect(execute.mock.calls.filter(([sql]) => sql.includes("SELECT is_guest_staff"))).toHaveLength(2);
  });

  it("releaseGuestPlanning_futureAutoAssignment_withdrawn", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }),
    );
    casterData({ confirmed: false });

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release.withdrawn).toBe(1);
    expect(release.failed).toBe(0);
    expect(execute).toHaveBeenCalledWith(
      "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ?",
      ["m:1", GUEST, "CASTER"],
    );
  });

  it("releaseGuestPlanning_castSignup_untouched", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({ entries: [loadedEntry()], matchCasters: new Map([["m:1", [GUEST]]]) }),
    );

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release.withdrawn).toBe(0);
    expect(execute.mock.calls.some(([sql]) => sql.includes("DELETE FROM bg_planning_assignments"))).toBe(false);
  });

  it("releaseGuestPlanning_pastEntry_untouched", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }),
    );

    const release = await releaseGuestPlanning(GUEST, STAFF, MONDAY + HOUR_MS);

    expect(release).toEqual({ withdrawn: 0, failed: 0, availabilityCleared: 0 });
    expect(assignmentDeletes()).toHaveLength(0);
  });

  it("releaseGuestPlanning_futureAvailability_cleared", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(planningData({ entries: [loadedEntry()] }));
    availabilityCleared = 2;

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release.availabilityCleared).toBe(2);
    expect(availabilityDeletes()[0][1]).toEqual([GUEST, new Date(EARLY)]);
  });

  it("releaseGuestPlanning_availability_deletedByDateForAllEntries", async () => {
    // Aucune entrée dans la fenêtre : une disponibilité d'un match reporté au-delà de l'horizon part quand même.
    jest.mocked(loadPlanningData).mockResolvedValueOnce(planningData({ entries: [] }));
    availabilityCleared = 1;

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release.availabilityCleared).toBe(1);
    const [sql] = availabilityDeletes()[0];
    expect(sql).toContain("LEFT JOIN bg_matches m ON m.id = a.match_id");
    expect(sql).toContain("IS NULL OR");
    expect(sql).not.toContain("entry_key IN");
  });

  it("releaseGuestPlanning_withdrawalFails_countsFailure", async () => {
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }))
      .mockRejectedValueOnce(new Error("panne"));

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release.withdrawn).toBe(0);
    expect(release.failed).toBe(1);
  });

  it("releaseGuestPlanning_loadFails_reportsOneFailure", async () => {
    jest.mocked(loadPlanningData).mockRejectedValueOnce(new Error("panne"));

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release).toEqual({ withdrawn: 0, failed: 1, availabilityCleared: 0 });
  });

  it("releaseGuestPlanning_staffRelease_eventCarriesActorAndNotLate", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }),
    );
    casterData({ confirmed: true });

    await releaseGuestPlanning(GUEST, STAFF, MONDAY - HOUR_MS);

    const event = execute.mock.calls.find(([sql]) => sql.includes("'WITHDRAWN'"));
    expect(event?.[1]).toEqual(["m:1", GUEST, "CASTER", 10, 1, "MANUAL", STAFF, null, 0, 1]);
    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ late: false });
  });

  it("releaseGuestPlanning_staffRelease_announcesReleasedWithActor", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }),
    );
    casterData({ confirmed: true });

    await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(jest.mocked(announceWithdrawal).mock.calls[0][0]).toMatchObject({ released: true, actorId: STAFF, withdrawnUserId: GUEST });
  });

  it("releaseGuestPlanning_entryClosedMeanwhile_countedFailed", async () => {
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }))
      .mockResolvedValueOnce(
        planningData({ entries: [loadedEntry({ editable: false })], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }),
      );

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release.withdrawn).toBe(0);
    expect(release.failed).toBe(1);
  });

  it("releaseGuestPlanning_confirmedReferee_matchNamesTheStaff", async () => {
    const members = [loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry({ matchRefereeId: GUEST })], assignments: [loadedAssignment({ userId: GUEST, confirmed: true })] }))
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry({ matchRefereeId: GUEST })], assignments: [loadedAssignment({ userId: GUEST, confirmed: true })], members }))
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], members, removals: [] }));
    jest.mocked(readMatchReferee).mockResolvedValue(GUEST);

    await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(jest.mocked(assignMatchReferee).mock.calls[0]).toEqual([1, STAFF, null, GUEST, { guestRelease: true }]);
  });

  // Revue juridique 2 : la pose du remplaçant d'un invité ne laisse pas non plus de ligne par match.
  it("releaseGuestPlanning_confirmedRefereeReplaced_replacementAssignedAsGuestRelease", async () => {
    const members = [loadedMember({ userId: 5 })];
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry({ matchRefereeId: GUEST })], assignments: [loadedAssignment({ userId: GUEST, confirmed: true })] }))
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry({ matchRefereeId: GUEST })], assignments: [loadedAssignment({ userId: GUEST, confirmed: true })], members }))
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], members, availability: [available("m:1", 5, "REFEREE")], removals: [] }));
    jest.mocked(readMatchReferee).mockResolvedValue(GUEST);

    await releaseGuestPlanning(GUEST, STAFF, EARLY);

    // Le remplaçant est posé au nom du staff qui sort l'invité, comme le retrait.
    expect(jest.mocked(assignMatchReferee).mock.calls[1]).toEqual([1, STAFF, 5, null, { refuseSuspended: true, guestRelease: true }]);
  });

  it("releaseGuestPlanning_alreadyGone_skippedNotFailed", async () => {
    jest
      .mocked(loadPlanningData)
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: GUEST, role: "CASTER" })] }))
      .mockResolvedValueOnce(planningData({ entries: [loadedEntry()] }));

    const release = await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(release).toEqual({ withdrawn: 0, failed: 0, availabilityCleared: 0 });
  });

  it("releaseGuestPlanning_availabilityRead_onlyTheGuest", async () => {
    jest.mocked(loadPlanningData).mockResolvedValueOnce(planningData({ entries: [] }));

    await releaseGuestPlanning(GUEST, STAFF, EARLY);

    expect(jest.mocked(loadPlanningData).mock.calls[0][1]).toMatchObject({ availabilityOf: GUEST, includeHidden: true });
  });
});

// Revue juridique 4 (PLANNING-GUESTS) : une seule règle pour l'auteur d'un geste sur l'arbitre d'un match.
describe("matchGestureFor", () => {
  it("matchGestureFor_memberWithdrawal_actorIsMemberNotSilenced", () => {
    expect(matchGestureFor(7, null)).toEqual({ actor: 7, options: { guestRelease: false } });
  });

  it("matchGestureFor_guestReleaseByStaff_actorIsStaffSilenced", () => {
    expect(matchGestureFor(7, 2)).toEqual({ actor: 2, options: { guestRelease: true } });
  });
});
