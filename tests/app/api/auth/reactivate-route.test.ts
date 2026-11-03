import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/account-reactivation", () => ({
  reactivationCookieName: () => "bg_reactivation",
  reactivateAccount: jest.fn(),
  peekReactivationTicket: jest.fn(),
}));
jest.mock("@/lib/server/account-suspensions", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/account-suspensions")>(
    "@/lib/server/account-suspensions",
  );
  return { ...actual, assertNotSuspended: jest.fn() };
});
jest.mock("next/headers", () => ({ cookies: jest.fn() }));

import { cookies } from "next/headers";
import { POST } from "@/app/api/auth/reactivate/route";
import { createSession } from "@/lib/server/auth";
import { AccountSuspendedError, assertNotSuspended } from "@/lib/server/account-suspensions";
import { peekReactivationTicket, reactivateAccount } from "@/lib/server/users/account-reactivation";
import { fakeCookieStore } from "../../../helpers/cookie-store";

/*
 * `POST /api/auth/reactivate` : le clic explicite qui relève une suppression
 * demandée (E4). Le ticket vient du cookie, sert une fois, et la session
 * s'ouvre par la porte commune.
 */

const get = jest.fn<(name: string) => { value: string } | undefined>();
const set = jest.fn<(name: string, value: string, options?: Record<string, unknown>) => void>();

const reactivate = (headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" }) =>
  POST(new Request("http://localhost:3000/api/auth/reactivate", { method: "POST", headers, body: "{}" }));

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReturnValue({ value: "a".repeat(64) });
  jest.mocked(cookies).mockResolvedValue(fakeCookieStore({ get, set }));
  jest.mocked(createSession).mockResolvedValue(undefined);
  jest.mocked(peekReactivationTicket).mockResolvedValue({ userId: 7, finalAt: "2026-12-03T10:00:00.000Z" });
  jest.mocked(assertNotSuspended).mockResolvedValue(undefined);
});

describe("POST /api/auth/reactivate", () => {
  it("POST_crossSite_403", async () => {
    const res = await reactivate({ "sec-fetch-site": "cross-site", "content-type": "application/json" });

    expect(res.status).toBe(403);
    expect(reactivateAccount).not.toHaveBeenCalled();
  });

  it("POST_expiredOrMissingTicket_410", async () => {
    get.mockReturnValue(undefined);
    jest.mocked(reactivateAccount).mockResolvedValue(null);

    const res = await reactivate();

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: "REACTIVATION_EXPIRED" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("POST_valid_opensSessionAndDeletesCookie", async () => {
    jest.mocked(reactivateAccount).mockResolvedValue({ userId: 7, event: "LOGIN_DISCORD" });

    const res = await reactivate();

    expect(res.status).toBe(200);
    expect(reactivateAccount).toHaveBeenCalledWith("a".repeat(64));
    expect(createSession).toHaveBeenCalledWith(7, "LOGIN_DISCORD");
    expect(set).toHaveBeenCalledWith("bg_reactivation", "", expect.objectContaining({ maxAge: 0, path: "/" }));
  });

  it("POST_production_clearsCookieSecure", async () => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production" });
    jest.mocked(reactivateAccount).mockResolvedValue({ userId: 7, event: "LOGIN_DISCORD" });

    await reactivate();

    // Un `__Host-` ne s'efface qu'avec `Secure`, comme il a été posé.
    expect(set).toHaveBeenCalledWith("bg_reactivation", "", expect.objectContaining({ secure: true, maxAge: 0 }));
    jest.restoreAllMocks();
  });

  it("POST_suspendedAccount_403", async () => {
    jest.mocked(reactivateAccount).mockResolvedValue({ userId: 7, event: "LOGIN_GOOGLE" });
    const notice = { reference: "S-1", reason: "Propos haineux en match", ground: "BEHAVIOR" as const, endsAt: null };
    jest.mocked(createSession).mockRejectedValue(new AccountSuspendedError(notice));

    const res = await reactivate();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ACCOUNT_SUSPENDED", suspension: notice });
  });

  it("POST_suspendedBeforeReactivation_403AndAccountLeftPending", async () => {
    const notice = { reference: "S-2", reason: "Triche", ground: "BEHAVIOR" as const, endsAt: null };
    jest.mocked(assertNotSuspended).mockRejectedValue(new AccountSuspendedError(notice));

    const res = await reactivate();

    expect(res.status).toBe(403);
    expect(assertNotSuspended).toHaveBeenCalledWith(7);
    expect(reactivateAccount).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("POST_unexpectedError_500WithCodeOnly", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(reactivateAccount).mockRejectedValue(new Error("Connection lost: secret details"));

    const res = await reactivate();

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    log.mockRestore();
  });
});
