import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/planning/withdrawal");

import { getDatabase } from "@/lib/server/database";
import { releaseGuestPlanning } from "@/lib/server/planning/withdrawal";
import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  PLANNING_GUEST_OFF_DISCORD_LINE,
  PLANNING_GUEST_ON_DISCORD_LINE,
  PLANNING_GUEST_REPLAY_DISCORD_LINE,
  planningGuestAuditLine,
  publishPlanningGuestChange,
  readPlanningGuest,
  setPlanningGuest,
} from "@/lib/server/users/planning-guest";
import { connectionMock, fakePool } from "../../../helpers/sql-double";

/** Drapeau « invité » du planning (`CAST_PLANNING.md` § Invités). */

const { execute } = connectionMock();
const release = { withdrawn: 2, failed: 1, availabilityCleared: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(releaseGuestPlanning).mockResolvedValue(release);
});

/** Le compte existe, puis l'écriture change `affectedRows` lignes. */
function account(affectedRows: number, isAdmin = 0) {
  execute.mockResolvedValueOnce([[{ id: 7, is_admin: isAdmin }], []]).mockResolvedValueOnce([{ affectedRows }, []]);
}

/** Le staff `roles` qui enregistre. */
const STAFF = 1;

describe("setPlanningGuest", () => {
  it("setPlanningGuest_changedToGuest_releasesFuturePlanning", async () => {
    account(1);

    const saved = await setPlanningGuest(7, true, STAFF, 1000);

    expect(saved).toEqual({ guest: true, changed: true, release });
    expect(releaseGuestPlanning).toHaveBeenCalledWith(7, STAFF, 1000);
  });

  it("setPlanningGuest_write_isConditional", async () => {
    account(1);

    await setPlanningGuest(7, true, STAFF, 1000);

    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("is_guest_staff <> ?");
    expect(params).toEqual([1, 7, 1]);
  });

  it("setPlanningGuest_alreadyGuest_replaysRelease", async () => {
    account(0);
    execute.mockResolvedValueOnce([[{ is_admin: 0, is_deleted: 0 }], []]);

    const saved = await setPlanningGuest(7, true, STAFF, 1000);

    expect(saved).toEqual({ guest: true, changed: false, release });
    expect(releaseGuestPlanning).toHaveBeenCalledWith(7, STAFF, 1000);
  });

  it("setPlanningGuest_adminTarget_throwsPlanningGuestAdmin", async () => {
    execute.mockResolvedValueOnce([[{ id: 7, is_admin: 1 }], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("PLANNING_GUEST_ADMIN");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_adminTargetUnflag_written", async () => {
    account(1, 1);

    const saved = await setPlanningGuest(7, false, STAFF, 1000);

    expect(saved).toEqual({ guest: false, changed: true, release: null });
  });

  it("setPlanningGuest_unflag_noRelease", async () => {
    account(1);

    const saved = await setPlanningGuest(7, false, STAFF, 1000);

    expect(saved).toEqual({ guest: false, changed: true, release: null });
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_guestWrite_rechecksAdminInUpdate", async () => {
    account(1);

    await setPlanningGuest(7, true, STAFF, 1000);

    expect(execute.mock.calls[1][0]).toContain("COALESCE(is_admin, 0) = 0");
  });

  it("setPlanningGuest_unflagWrite_noAdminCondition", async () => {
    account(1);

    await setPlanningGuest(7, false, STAFF, 1000);

    expect(execute.mock.calls[1][0]).not.toContain("is_admin");
  });

  it("setPlanningGuest_promotedBetweenReadAndWrite_throwsPlanningGuestAdmin", async () => {
    account(0);
    execute.mockResolvedValueOnce([[{ is_admin: 1, is_deleted: 0 }], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("PLANNING_GUEST_ADMIN");
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_deletedBetweenReadAndWrite_throwsUserNotFound", async () => {
    account(0);
    execute.mockResolvedValueOnce([[{ is_admin: 0, is_deleted: 1 }], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("USER_NOT_FOUND");
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_missingUser_throwsUserNotFound", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("USER_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("publishPlanningGuestChange", () => {
  const actor = { id: 1, pseudo: "Test_Admin" };

  it("publishPlanningGuestChange_replayWithoutEffect_publishesNothing", () => {
    const idle = { withdrawn: 0, failed: 0, availabilityCleared: 0 };

    const published = publishPlanningGuestChange(actor, 7, { guest: true, changed: false, release: idle });

    expect(published).toBe(false);
    expect(publishStaffAction).not.toHaveBeenCalled();
  });

  it("publishPlanningGuestChange_replayWithEffect_publishesReplayLine", () => {
    const published = publishPlanningGuestChange(actor, 7, { guest: true, changed: false, release });

    expect(published).toBe(true);
    expect(publishStaffAction).toHaveBeenCalledWith(PLANNING_GUEST_REPLAY_DISCORD_LINE, actor, {
      auditLine: "🎙️ Compte #7 déjà invité : sortie du planning rejouée — attributions à venir quittées : 2, laissées en place : 1, disponibilités effacées : 3.",
      category: "admin",
    });
    expect(PLANNING_GUEST_REPLAY_DISCORD_LINE).not.toMatch(/#\d|Test_/);
  });

  it("publishPlanningGuestChange_flagged_anonymousDiscordNamedPm2", () => {
    publishPlanningGuestChange(actor, 7, { guest: true, changed: true, release });

    expect(publishStaffAction).toHaveBeenCalledWith(PLANNING_GUEST_ON_DISCORD_LINE, actor, {
      auditLine: "🎙️ Compte #7 passé invité (hors planning) — attributions à venir quittées : 2, laissées en place : 1, disponibilités effacées : 3.",
      category: "admin",
    });
  });

  it("publishPlanningGuestChange_unflagged_offLine", () => {
    const saved = { guest: false, changed: true, release: null };

    publishPlanningGuestChange(actor, 7, saved);

    expect(publishStaffAction).toHaveBeenCalledWith(PLANNING_GUEST_OFF_DISCORD_LINE, actor, {
      auditLine: planningGuestAuditLine(7, saved),
      category: "admin",
    });
  });

  it("planningGuestDiscordLines_nameNoAccountNorStaff", () => {
    expect(PLANNING_GUEST_ON_DISCORD_LINE).not.toMatch(/#\d|Test_/);
    expect(PLANNING_GUEST_OFF_DISCORD_LINE).not.toMatch(/#\d|Test_/);
  });
});

describe("readPlanningGuest", () => {
  it("readPlanningGuest_flaggedRow_returnsTrue", async () => {
    execute.mockResolvedValueOnce([[{ is_guest_staff: 1 }], []]);

    await expect(readPlanningGuest(7)).resolves.toBe(true);
  });

  it("readPlanningGuest_readFails_returnsNull", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(new Error("Unknown column"));

    await expect(readPlanningGuest(7)).resolves.toBeNull();
  });
});
