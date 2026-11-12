import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/connection-logs");
jest.mock("@/lib/server/account-suspensions", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/account-suspensions")>(
    "@/lib/server/account-suspensions",
  );
  return { ...actual, assertNotSuspended: jest.fn(async () => undefined), purgeEndedSuspensions: jest.fn(async () => undefined) };
});
jest.mock("@/lib/server/users/account-reactivation", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/users/account-reactivation")>(
    "@/lib/server/users/account-reactivation",
  );
  return { ...actual, readPendingDeletion: jest.fn(), createReactivationTicket: jest.fn() };
});
jest.mock("next/headers", () => ({ cookies: jest.fn(), redirect: jest.fn() }));

import { cookies } from "next/headers";
import { createSession } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/database";
import {
  AccountDeletedError,
  AccountPendingDeletionError,
  createReactivationTicket,
  readPendingDeletion,
} from "@/lib/server/users/account-reactivation";
import { fakeCookieStore } from "../../helpers/cookie-store";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/*
 * `createSession`, porte commune des connexions, face à un compte dont la
 * suppression est demandée (E4) : jamais de session en silence.
 */

const set = jest.fn<(name: string, value: string, options?: object) => void>();
const execute = jest.fn<SqlQuery>();

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockResolvedValue([[], []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(cookies).mockResolvedValue(fakeCookieStore({ set, get: jest.fn(), delete: jest.fn() }));
});

describe("createSession — compte en attente de suppression", () => {
  it("createSession_pendingWindowOpen_setsReactivationCookieAndThrowsPending", async () => {
    jest.mocked(readPendingDeletion).mockResolvedValue({ requestedAt: "2026-11-01T00:00:00.000Z", windowOpen: true });
    jest.mocked(createReactivationTicket).mockResolvedValue("b".repeat(64));

    await expect(createSession(7, "LOGIN_GOOGLE")).rejects.toBeInstanceOf(AccountPendingDeletionError);

    expect(createReactivationTicket).toHaveBeenCalledWith(7, "LOGIN_GOOGLE");
    expect(set).toHaveBeenCalledWith("bg_reactivation", "b".repeat(64), expect.objectContaining({ httpOnly: true, maxAge: 900 }));
    expect(execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO bg_user_sessions"))).toBe(false);
  });

  it("createSession_pendingWindowClosed_throwsAccountDeletedWithoutTicket", async () => {
    jest.mocked(readPendingDeletion).mockResolvedValue({ requestedAt: "2026-09-01T00:00:00.000Z", windowOpen: false });

    await expect(createSession(7, "LOGIN_GOOGLE")).rejects.toThrow("ACCOUNT_DELETED");
    await expect(createSession(7, "LOGIN_GOOGLE")).rejects.toBeInstanceOf(AccountDeletedError);

    expect(createReactivationTicket).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
