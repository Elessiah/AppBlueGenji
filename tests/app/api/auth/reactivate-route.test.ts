import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/account-reactivation", () => ({
  REACTIVATION_COOKIE: "bg_reactivation",
  reactivateAccount: jest.fn(),
}));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));

import { cookies } from "next/headers";
import { POST } from "@/app/api/auth/reactivate/route";
import { createSession } from "@/lib/server/auth";
import { AccountSuspendedError } from "@/lib/server/account-suspensions";
import { reactivateAccount } from "@/lib/server/users/account-reactivation";
import { fakeCookieStore } from "../../../helpers/cookie-store";

/*
 * `POST /api/auth/reactivate` : le clic explicite qui relève une suppression
 * demandée (E4). Le ticket vient du cookie, sert une fois, et la session
 * s'ouvre par la porte commune.
 */

const get = jest.fn<(name: string) => { value: string } | undefined>();
const remove = jest.fn<(name: string) => void>();

const reactivate = (headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" }) =>
  POST(new Request("http://localhost:3000/api/auth/reactivate", { method: "POST", headers, body: "{}" }));

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReturnValue({ value: "a".repeat(64) });
  jest.mocked(cookies).mockResolvedValue(fakeCookieStore({ get, delete: remove }));
  jest.mocked(createSession).mockResolvedValue(undefined);
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
    expect(remove).toHaveBeenCalledWith("bg_reactivation");
  });

  it("POST_suspendedAccount_403", async () => {
    jest.mocked(reactivateAccount).mockResolvedValue({ userId: 7, event: "LOGIN_GOOGLE" });
    const notice = { reference: "S-1", reason: "Propos haineux en match", ground: "BEHAVIOR" as const, endsAt: null };
    jest.mocked(createSession).mockRejectedValue(new AccountSuspendedError(notice));

    const res = await reactivate();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ACCOUNT_SUSPENDED", suspension: notice });
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
