import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/users/planning-guest");

import { getDatabase } from "@/lib/server/database";
import { getFullProfile } from "@/lib/server/users/full-profile";
import { readPlanningGuest } from "@/lib/server/users/planning-guest";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/** La fiche ne porte le drapeau « invité » qu'au staff `roles` (`CAST_PLANNING.md` § Invités). */

const userRow = {
  id: 7,
  pseudo: "Player",
  avatar_url: null,
  overwatch_battletag: null,
  marvel_rivals_tag: null,
  discord_pseudo: null,
  discord_verified_at: null,
  is_adult: 1,
  visible_avatar: 1,
  visible_pseudo: 1,
  visible_overwatch: 1,
  visible_marvel: 1,
  visible_major: 1,
  is_admin: 0,
  created_at: new Date("2026-01-01T00:00:00Z"),
};

function target(row: typeof userRow) {
  const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[row]]).mockResolvedValue([[]]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(() => {
  jest.clearAllMocks();
  target(userRow);
  jest.mocked(readPlanningGuest).mockResolvedValue(true);
});

describe("getFullProfile — drapeau invité", () => {
  it("getFullProfile_rolesViewer_exposesPlanningGuest", async () => {
    const profile = await getFullProfile({ id: 1, isAdmin: true, roles: ["ADMIN"] }, 7);

    expect(profile?.planningGuest).toBe(true);
    expect(readPlanningGuest).toHaveBeenCalledWith(7);
  });

  it("getFullProfile_staffWithoutRoles_hidesPlanningGuest", async () => {
    const profile = await getFullProfile({ id: 1, roles: ["CASTER", "ARBITRE"] }, 7);

    expect(profile?.planningGuest).toBeUndefined();
    expect(readPlanningGuest).not.toHaveBeenCalled();
  });

  it("getFullProfile_rolesViewerOwnProfile_hidesPlanningGuest", async () => {
    const profile = await getFullProfile({ id: 7, isAdmin: true, roles: ["ADMIN"] }, 7);

    expect(profile?.planningGuest).toBeUndefined();
  });

  it("getFullProfile_adminTargetNotFlagged_hidesPlanningGuest", async () => {
    target({ ...userRow, is_admin: 1 });
    jest.mocked(readPlanningGuest).mockResolvedValue(false);

    const profile = await getFullProfile({ id: 1, isAdmin: true, roles: ["ADMIN"] }, 7);

    expect(profile?.planningGuest).toBeUndefined();
  });

  it("getFullProfile_adminTargetFlagged_offersUnflag", async () => {
    target({ ...userRow, is_admin: 1 });

    const profile = await getFullProfile({ id: 1, isAdmin: true, roles: ["ADMIN"] }, 7);

    expect(profile?.planningGuest).toBe(true);
  });
});
