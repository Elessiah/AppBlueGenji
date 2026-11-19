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
function account(affectedRows: number) {
  execute.mockResolvedValueOnce([[{ id: 7 }], []]).mockResolvedValueOnce([{ affectedRows }, []]);
}

describe("setPlanningGuest", () => {
  it("setPlanningGuest_changedToGuest_releasesFuturePlanning", async () => {
    account(1);

    const saved = await setPlanningGuest(7, true, 1000);

    expect(saved).toEqual({ guest: true, changed: true, release });
    expect(releaseGuestPlanning).toHaveBeenCalledWith(7, 1000);
  });

  it("setPlanningGuest_write_isConditional", async () => {
    account(1);

    await setPlanningGuest(7, true, 1000);

    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("is_guest_staff <> ?");
    expect(params).toEqual([1, 7, 1]);
  });

  it("setPlanningGuest_alreadyGuest_noRelease", async () => {
    account(0);

    const saved = await setPlanningGuest(7, true, 1000);

    expect(saved).toEqual({ guest: true, changed: false, release: null });
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_unflag_noRelease", async () => {
    account(1);

    const saved = await setPlanningGuest(7, false, 1000);

    expect(saved).toEqual({ guest: false, changed: true, release: null });
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_missingUser_throwsUserNotFound", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await expect(setPlanningGuest(7, true, 1000)).rejects.toThrow("USER_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("publishPlanningGuestChange", () => {
  const actor = { id: 1, pseudo: "Test_Admin" };

  it("publishPlanningGuestChange_unchanged_publishesNothing", () => {
    const published = publishPlanningGuestChange(actor, 7, { guest: true, changed: false, release: null });

    expect(published).toBe(false);
    expect(publishStaffAction).not.toHaveBeenCalled();
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
