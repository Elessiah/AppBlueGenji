import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readSource } from "../../helpers/read-source";
import {
  countOtherSessions,
  devBypassSessionKey,
  getCurrentUser,
  revokeOtherSessions,
  playerViewSessionKey,
  resetUnknownColumnMemoForTests,
} from "@/lib/server/auth";
import { can, isStaffMember, type Permission } from "@/lib/shared/permissions";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { fakeCookieStore } from "../../helpers/cookie-store";
import { authUser } from "../../helpers/auth-user";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/connection-logs");
jest.mock("@/lib/server/account-suspensions", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/account-suspensions")>(
    "@/lib/server/account-suspensions",
  );
  return {
    ...actual,
    assertNotSuspended: jest.fn(async () => undefined),
    purgeEndedSuspensions: jest.fn(async () => undefined),
  };
});
jest.mock("@/lib/server/users/account-reactivation", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/users/account-reactivation")>(
    "@/lib/server/users/account-reactivation",
  );
  return { ...actual, readPendingDeletion: jest.fn(async () => null) };
});
jest.mock("next/headers", () => ({ cookies: jest.fn(), redirect: jest.fn() }));

const originalEnv = { ...process.env };
const PERMISSIONS: Permission[] = [
  "tournaments",
  "casting",
  "live",
  "showcase",
  "recruitment",
  "roles",
  "moderation",
  "dev",
];

const baseRow = {
  id: 3,
  pseudo: "P",
  avatar_url: null,
  discord_id: null,
  google_sub: null,
  is_adult: 1,
  is_admin: 0,
  platform_roles_json: null,
  recruitment_modal_off: 0,
  certify_prompt_due: 0,
};

async function withCookie(token: string | null) {
  const { cookies } = await import("next/headers");
  jest
    .mocked(cookies)
    .mockResolvedValue(fakeCookieStore({ get: jest.fn().mockReturnValue(token === null ? undefined : { value: token }) }));
}

async function withExecute(execute: jest.Mock<SqlQuery>) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function devBypass(userId: string) {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development";
  env.DEV_AUTH_USER_ID = userId;
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
  resetUnknownColumnMemoForTests();
  await withCookie("tok");
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getCurrentUser — vue joueur", () => {
  it("getCurrentUser_adminInPlayerView_seesNoPermission", async () => {
    await withExecute(jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, is_admin: 1, player_view: 1 }], []]));

    const user = await getCurrentUser();

    expect(user).toMatchObject({ isAdmin: false, roles: [], playerView: true, playerViewAvailable: true });
    expect(PERMISSIONS.filter((permission) => can(user, permission))).toEqual([]);
    expect(isStaffMember(user)).toBe(false);
  });

  it("getCurrentUser_cumulativeRolesInPlayerView_seesNoPermission", async () => {
    const roles = JSON.stringify(["ARBITRE", "CASTER", "COMMUNITY_MANAGER", "RECRUTEUR", "DEV"]);
    await withExecute(
      jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, platform_roles_json: roles, player_view: 1 }], []]),
    );

    const user = await getCurrentUser();

    expect(user).toMatchObject({ roles: [], playerViewAvailable: true });
    expect(PERMISSIONS.filter((permission) => can(user, permission))).toEqual([]);
  });

  it("getCurrentUser_playerViewExpired_restoresRealRights", async () => {
    // Échéance passée : `player_view_until > NOW()` rend 0.
    await withExecute(jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, is_admin: 1, player_view: 0 }], []]));

    const user = await getCurrentUser();

    expect(user).toMatchObject({ isAdmin: true, playerView: false, playerViewAvailable: true });
    expect(PERMISSIONS.filter((permission) => !can(user, permission))).toEqual([]);
  });

  it("getCurrentUser_neverInPlayerView_keepsRealRights", async () => {
    await withExecute(
      jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, platform_roles_json: '["ARBITRE"]', player_view: null }], []]),
    );

    const user = await getCurrentUser();

    expect(user).toMatchObject({ roles: ["ARBITRE"], playerView: false, playerViewAvailable: true });
    expect(can(user, "tournaments")).toBe(true);
  });

  it("getCurrentUser_playerViewRow_exposesPlayerViewUntilIso", async () => {
    await withExecute(
      jest
        .fn<SqlQuery>()
        .mockResolvedValue([[{ ...baseRow, is_admin: 1, player_view: 1, player_view_until: new Date("2026-11-18T22:00:00.000Z") }], []]),
    );

    const user = await getCurrentUser();

    expect(user?.playerViewUntil).toBe("2026-11-18T22:00:00.000Z");
  });

  it("getCurrentUser_noRightsAccountWithStaleRow_playerViewUntilNull", async () => {
    await withExecute(
      jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, player_view: 1, player_view_until: "2026-11-18T22:00:00.000Z" }], []]),
    );

    const user = await getCurrentUser();

    expect(user?.playerViewUntil).toBeNull();
  });

  it("getCurrentUser_playerViewOff_playerViewUntilNull", async () => {
    await withExecute(
      jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, is_admin: 1, player_view: 0, player_view_until: "2026-11-17T22:00:00.000Z" }], []]),
    );

    const user = await getCurrentUser();

    expect(user?.playerViewUntil).toBeNull();
  });

  it("getCurrentUser_plainPlayerWithFlag_isNotInPlayerView", async () => {
    await withExecute(jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, player_view: 1 }], []]));

    const user = await getCurrentUser();

    expect(user).toMatchObject({ playerView: false, playerViewAvailable: false, roles: [] });
  });

  it("getCurrentUser_cookieSession_readsTheDeadlineOfThisSessionOnly", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[baseRow], []]);
    await withExecute(execute);

    await getCurrentUser();

    expect(String(execute.mock.calls[0][0])).toContain("s.player_view_until > NOW() AS player_view");
  });

  it("getCurrentUser_playerViewColumnMissing_readsWithoutItAndKeepsRights", async () => {
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("player_view_until")) {
        throw Object.assign(new Error("Unknown column 's.player_view_until'"), {
          code: "ER_BAD_FIELD_ERROR",
          errno: 1054,
        });
      }
      return [[{ ...baseRow, is_admin: 1 }], []];
    });
    await withExecute(execute);

    const user = await getCurrentUser();

    expect(user).toMatchObject({ isAdmin: true, playerView: false });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("getCurrentUser_devBypassInPlayerView_seesNoPermission", async () => {
    devBypass("3");
    await withCookie(null);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...baseRow, is_admin: 1, player_view: 1 }], []]);
    await withExecute(execute);

    const user = await getCurrentUser();

    expect(user).toMatchObject({ isAdmin: false, roles: [], playerView: true });
    expect(String(execute.mock.calls[0][0])).toContain("CONCAT('dev-auth-bypass:', bg_users.id)");
  });
});

describe("devBypassSessionKey", () => {
  it("devBypassSessionKey_anyAccount_isNeverACookieHash", () => {
    const key = devBypassSessionKey(342129);

    expect(key).toBe("dev-auth-bypass:342129");
    expect(key).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("playerViewSessionKey", () => {
  it("playerViewSessionKey_cookieSession_returnsTokenHash", async () => {
    const key = await playerViewSessionKey(authUser({ id: 3 }));

    expect(key).toEqual({ tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), devBypass: false });
  });

  it("playerViewSessionKey_noCookie_returnsNull", async () => {
    await withCookie(null);

    expect(await playerViewSessionKey(authUser({ id: 3 }))).toBeNull();
  });

  it("playerViewSessionKey_devBypassUserObject_returnsBypassKeyWithoutDb", async () => {
    devBypass("3");
    await withCookie(null);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[baseRow], []]);
    await withExecute(execute);
    const user = await getCurrentUser();
    execute.mockClear();

    const key = await playerViewSessionKey(user!);

    expect(key).toEqual({ tokenHash: "dev-auth-bypass:3", devBypass: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("playerViewSessionKey_lookalikeUserNotFromBypass_usesCookie", async () => {
    devBypass("3");

    const key = await playerViewSessionKey(authUser({ id: 3 }));

    expect(key).toEqual({ tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), devBypass: false });
  });
});

describe("autres appareils — ligne du contournement écartée", () => {
  it("countOtherSessions_devBypassRow_isNotCounted", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ c: 0 }], []]);
    await withExecute(execute);

    await countOtherSessions(3);

    expect(execute.mock.calls[0][0]).toContain("token_hash NOT LIKE 'dev-auth-bypass:%'");
  });

  it("revokeOtherSessions_devBypassRow_isKept", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }, undefined]);
    await withExecute(execute);

    await revokeOtherSessions(3);

    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining("token_hash NOT LIKE 'dev-auth-bypass:%'"),
      expect.stringContaining("token_hash NOT LIKE 'dev-auth-bypass:%'"),
    ]);
  });
});

describe("requête du contournement de développement", () => {
  it("devBypassSql_usesExistsNotACount", () => {
    expect(readSource("lib/server/auth.ts")).toContain("EXISTS(SELECT 1 FROM bg_user_sessions dv");
    expect(readSource("lib/server/auth.ts")).not.toContain("(SELECT COUNT(*) FROM bg_user_sessions dv");
  });
});
