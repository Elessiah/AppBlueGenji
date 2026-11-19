import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getCurrentUser, resetUnknownColumnMemoForTests } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { fakeCookieStore } from "../../helpers/cookie-store";

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

/** Session d'un caster **invité** (`CAST_PLANNING.md` § Invités) : sans planning, le reste intact. */

const originalEnv = { ...process.env };

const casterRow = {
  id: 3,
  pseudo: "P",
  avatar_url: null,
  discord_id: null,
  google_sub: null,
  is_adult: 1,
  is_admin: 0,
  platform_roles_json: '["CASTER"]',
  recruitment_modal_off: 0,
  certify_prompt_due: 0,
};

async function withExecute(execute: jest.Mock<SqlQuery>) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
  resetUnknownColumnMemoForTests();
  const { cookies } = await import("next/headers");
  jest.mocked(cookies).mockResolvedValue(fakeCookieStore({ get: jest.fn().mockReturnValue({ value: "tok" }) }));
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getCurrentUser — invité du planning", () => {
  it("getCurrentUser_guestRow_losesPlanningOnly", async () => {
    await withExecute(jest.fn<SqlQuery>().mockResolvedValue([[{ ...casterRow, is_guest_staff: 1 }], []]));

    const user = await getCurrentUser();

    expect(user?.planningGuest).toBe(true);
    expect(can(user, "planning")).toBe(false);
    expect(can(user, "casting")).toBe(true);
    expect(can(user, "live")).toBe(true);
  });

  it("getCurrentUser_memberRow_keepsPlanning", async () => {
    await withExecute(jest.fn<SqlQuery>().mockResolvedValue([[{ ...casterRow, is_guest_staff: 0 }], []]));

    const user = await getCurrentUser();

    expect(user?.planningGuest).toBe(false);
    expect(can(user, "planning")).toBe(true);
  });

  it("getCurrentUser_sessionSql_readsGuestColumn", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ ...casterRow, is_guest_staff: 0 }], []]);
    await withExecute(execute);

    await getCurrentUser();

    expect(execute.mock.calls[0][0]).toContain("is_guest_staff");
  });

  it("getCurrentUser_guestColumnMissing_retriesWithoutIt", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockRejectedValueOnce(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }))
      .mockResolvedValue([[casterRow], []]);
    await withExecute(execute);

    const user = await getCurrentUser();

    expect(execute.mock.calls[1][0]).not.toContain("is_guest_staff");
    expect(user?.planningGuest).toBe(false);
  });
});
