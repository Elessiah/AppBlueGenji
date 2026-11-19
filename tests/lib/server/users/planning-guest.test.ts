import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/staff-audit");
jest.mock("@/lib/server/planning/withdrawal");

import { getDatabase } from "@/lib/server/database";
import { releaseGuestPlanning } from "@/lib/server/planning/withdrawal";
import { publishStaffAction } from "@/lib/server/staff-audit";
import {
  holdsGuestEligibleRole,
  PLANNING_GUEST_OFF_DISCORD_LINE,
  PLANNING_GUEST_ON_DISCORD_LINE,
  PLANNING_GUEST_REPLAY_DISCORD_LINE,
  planningGuestAuditLine,
  publishPlanningGuestChange,
  readPlanningGuest,
  setPlanningGuest,
} from "@/lib/server/users/planning-guest";
import { connectionMock, fakeConnection, fakePool } from "../../../helpers/sql-double";

/** Drapeau « invité » du planning (`CAST_PLANNING.md` § Invités). */

const { execute } = connectionMock();
/** La transaction de l'écriture (auteur et cible verrouillés). */
const tx = connectionMock();
const release = { withdrawn: 2, failed: 1, availabilityCleared: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  // Une réponse prévue et pas consommée (écriture évitée) ne passe pas au test suivant.
  execute.mockReset();
  tx.execute.mockReset();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: async () => fakeConnection(tx) }));
  jest.mocked(releaseGuestPlanning).mockResolvedValue(release);
});

/** Le staff `roles` qui enregistre. */
const STAFF = 1;

type Target = { isAdmin?: number; roles?: string[] | null; flagged?: number };

/** L'auteur administrateur et le compte existent (lecture sans verrou), puis les deux lignes verrouillées : l'auteur (administrateur) et la cible. */
function locked(target: Target | null, actorIsAdmin = 1) {
  execute.mockResolvedValueOnce([[{ id: STAFF, is_admin: 1 }, { id: 7, is_admin: 0 }], []]);
  const rows: { id: number; is_admin: number; platform_roles_json: string | null; is_guest_staff: number }[] = [
    { id: STAFF, is_admin: actorIsAdmin, platform_roles_json: null, is_guest_staff: 0 },
  ];
  if (target) {
    rows.push({
      id: 7,
      is_admin: target.isAdmin ?? 0,
      platform_roles_json: target.roles === undefined ? JSON.stringify(["CASTER"]) : target.roles === null ? null : JSON.stringify(target.roles),
      is_guest_staff: target.flagged ?? 0,
    });
  }
  tx.execute.mockResolvedValueOnce([rows, []]).mockResolvedValueOnce([{ affectedRows: 1 }, []]);
}

/** Les requêtes de la transaction, dans l'ordre. */
function txSql(): string[] {
  return tx.execute.mock.calls.map(([sql]) => sql);
}

describe("setPlanningGuest", () => {
  it("setPlanningGuest_casterTargetNotFlagged_writesFlagAndReleases", async () => {
    locked({});

    const saved = await setPlanningGuest(7, true, STAFF, 1000);

    expect(saved).toEqual({ guest: true, changed: true, release });
    expect(tx.execute.mock.calls[1]).toEqual([expect.stringContaining("UPDATE bg_users SET is_guest_staff = ?"), [1, 7]]);
    expect(tx.commit).toHaveBeenCalledTimes(1);
    expect(releaseGuestPlanning).toHaveBeenCalledWith(7, STAFF, 1000);
  });

  it("setPlanningGuest_locksActorAndTargetFirst", async () => {
    locked({});

    await setPlanningGuest(7, true, STAFF, 1000);

    expect(tx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(tx.execute.mock.calls[0]).toEqual([expect.stringMatching(/WHERE id IN \(\?, \?\).*ORDER BY id FOR UPDATE/), [STAFF, 7]]);
    expect(tx.release).toHaveBeenCalledTimes(1);
  });

  it("setPlanningGuest_actorNoLongerAdmin_throwsNotAdmin", async () => {
    locked({}, 0);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("NOT_ADMIN");
    expect(txSql()).toHaveLength(1);
    expect(tx.rollback).toHaveBeenCalledTimes(1);
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_targetDeletedMeanwhile_throwsUserNotFound", async () => {
    locked(null);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("USER_NOT_FOUND");
    expect(txSql()).toHaveLength(1);
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_adminTarget_throwsPlanningGuestAdmin", async () => {
    locked({ isAdmin: 1 });

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("PLANNING_GUEST_ADMIN");
    expect(txSql()).toHaveLength(1);
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_targetWithoutCasterOrProd_throwsNotStaff", async () => {
    locked({ roles: ["ARBITRE"] });

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("PLANNING_GUEST_NOT_STAFF");
    expect(txSql()).toHaveLength(1);
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_targetWithoutRoles_throwsNotStaff", async () => {
    locked({ roles: null });

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("PLANNING_GUEST_NOT_STAFF");
  });

  it("setPlanningGuest_prodTarget_accepted", async () => {
    locked({ roles: ["PROD"] });

    const saved = await setPlanningGuest(7, true, STAFF, 1000);

    expect(saved.changed).toBe(true);
  });

  it("setPlanningGuest_alreadyFlaggedWithoutRole_replaysRelease", async () => {
    locked({ roles: [], flagged: 1 });

    const saved = await setPlanningGuest(7, true, STAFF, 1000);

    expect(saved).toEqual({ guest: true, changed: false, release });
    expect(txSql()).toHaveLength(1);
    expect(releaseGuestPlanning).toHaveBeenCalledWith(7, STAFF, 1000);
  });

  it("setPlanningGuest_unflagAdminTarget_written", async () => {
    locked({ isAdmin: 1, flagged: 1 });

    const saved = await setPlanningGuest(7, false, STAFF, 1000);

    expect(saved).toEqual({ guest: false, changed: true, release: null });
    expect(tx.execute.mock.calls[1][1]).toEqual([0, 7]);
  });

  it("setPlanningGuest_unflag_noRelease", async () => {
    locked({ flagged: 1 });

    const saved = await setPlanningGuest(7, false, STAFF, 1000);

    expect(saved).toEqual({ guest: false, changed: true, release: null });
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_unflagNotFlagged_noWriteNoRelease", async () => {
    locked({});

    const saved = await setPlanningGuest(7, false, STAFF, 1000);

    expect(saved).toEqual({ guest: false, changed: false, release: null });
    expect(txSql()).toHaveLength(1);
    expect(releaseGuestPlanning).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_missingUser_throwsUserNotFoundWithoutTransaction", async () => {
    execute.mockResolvedValueOnce([[{ id: STAFF, is_admin: 1 }], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("USER_NOT_FOUND");
    expect(tx.beginTransaction).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_demotedActorUnknownTarget_throwsNotAdminWithoutTransaction", async () => {
    execute.mockResolvedValueOnce([[{ id: STAFF, is_admin: 0 }], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("NOT_ADMIN");
    expect(tx.beginTransaction).not.toHaveBeenCalled();
  });

  it("setPlanningGuest_preRead_readsActorAndTargetTogether", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await expect(setPlanningGuest(7, true, STAFF, 1000)).rejects.toThrow("NOT_ADMIN");
    expect(execute.mock.calls[0]).toEqual([expect.stringContaining("WHERE id IN (?, ?) AND is_deleted = 0"), [STAFF, 7]]);
  });
});

describe("holdsGuestEligibleRole", () => {
  it("holdsGuestEligibleRole_casterAmongRoles_true", () => {
    expect(holdsGuestEligibleRole(JSON.stringify(["ARBITRE", "CASTER"]))).toBe(true);
  });

  it("holdsGuestEligibleRole_refereeOnly_false", () => {
    expect(holdsGuestEligibleRole(JSON.stringify(["ARBITRE"]))).toBe(false);
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
