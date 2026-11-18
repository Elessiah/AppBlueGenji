import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/discord-dm-test", () => ({
  ...jest.requireActual<typeof import("@/lib/server/discord-dm-test")>("@/lib/server/discord-dm-test"),
  sendDiscordDmTest: jest.fn(),
}));

import { POST } from "@/app/api/profile/discord/dm-test/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  DM_TEST_MAX_TRACKED_ACCOUNTS,
  DmTestError,
  reserveDmTestTry,
  resetDmTestTries,
  sendDiscordDmTest,
} from "@/lib/server/discord-dm-test";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/profile/discord/dm-test` : test des messages privés, plafonné par compte. */

const URL_DM_TEST = "http://localhost:3000/api/profile/discord/dm-test";
const sameSite = () =>
  new Request(URL_DM_TEST, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: "{}",
  });

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  resetDmTestTries();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(sendDiscordDmTest).mockResolvedValue("SENT");
});

describe("POST /api/profile/discord/dm-test", () => {
  it("post_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await POST(sameSite());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(sendDiscordDmTest).not.toHaveBeenCalled();
  });

  it("post_sent_returns200WithOutcome", async () => {
    const response = await POST(sameSite());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "SENT" });
    expect(sendDiscordDmTest).toHaveBeenCalledWith(7, expect.any(AbortSignal));
  });

  it("post_overLimit_returns429AfterThreeTries", async () => {
    await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(sendDiscordDmTest).toHaveBeenCalledTimes(3);
  });

  it("post_busy_returns503AndRefundsQuota", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("DISCORD_DM_TEST_BUSY", true));
    for (let i = 0; i < 5; i += 1) {
      const response = await POST(sameSite());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "DISCORD_DM_TEST_BUSY" });
    }
  });

  it("post_notCertified_returns409AndRefundsQuota", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("DISCORD_NOT_CERTIFIED", true));
    await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "DISCORD_NOT_CERTIFIED" });
  });

  it("post_notLinked_returns409", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("DISCORD_NOT_LINKED", true));

    const response = await POST(sameSite());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "DISCORD_NOT_LINKED" });
  });

  it("post_profileNotFound_returns404", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("PROFILE_NOT_FOUND", true));

    const response = await POST(sameSite());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "PROFILE_NOT_FOUND" });
  });

  it("post_botUnreachable_returns503AndKeepsQuota", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("BOT_INTERNAL_UNREACHABLE", false));
    const first = await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const fourth = await POST(sameSite());

    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ error: "BOT_INTERNAL_UNREACHABLE" });
    expect(fourth.status).toBe(429);
  });

  it("post_crossSiteOrigin_returns403BeforeQuota", async () => {
    const forged = new Request(URL_DM_TEST, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    });

    const response = await POST(forged);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "CROSS_SITE_REQUEST" });
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(sendDiscordDmTest).not.toHaveBeenCalled();
  });

  it("post_unexpectedError_returns500GenericCode", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new Error("Connection lost: secret detail"));

    const response = await POST(sameSite());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "DISCORD_DM_TEST_FAILED" });
  });
  it("post_noJsonContentType_returns415BeforeAuth", async () => {
    const form = new Request(URL_DM_TEST, { method: "POST", headers: { "sec-fetch-site": "same-origin" } });

    const response = await POST(form);

    expect(response.status).toBe(415);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(sendDiscordDmTest).not.toHaveBeenCalled();
  });

  it("post_slidingWindow_refusesFourthUntilTheOldestTryIsAnHourOld", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-18T10:00:00Z") });
    try {
      await POST(sameSite());
      jest.setSystemTime(new Date("2026-11-18T10:30:00Z"));
      await POST(sameSite());
      jest.setSystemTime(new Date("2026-11-18T10:59:30Z"));
      await POST(sameSite());
      const refused = await POST(sameSite());
      jest.setSystemTime(new Date("2026-11-18T11:00:01Z"));

      const accepted = await POST(sameSite());

      expect(refused.status).toBe(429);
      expect(accepted.status).toBe(200);
      expect(sendDiscordDmTest).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it("post_overLimit_returns429WithRetryAfter", async () => {
    await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(3500);
  });

  it("post_refusedTriesDoNotExtendTheWindow", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-18T10:00:00Z") });
    try {
      await POST(sameSite());
      await POST(sameSite());
      jest.setSystemTime(new Date("2026-11-18T10:50:00Z"));
      jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("DISCORD_NOT_LINKED", true));
      await POST(sameSite());
      await POST(sameSite());
      jest.mocked(sendDiscordDmTest).mockResolvedValue("SENT");
      jest.setSystemTime(new Date("2026-11-18T11:00:01Z"));

      const statuses = [];
      for (let i = 0; i < 3; i += 1) statuses.push((await POST(sameSite())).status);

      expect(statuses).toEqual([200, 200, 200]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("post_attemptCap_returns429AfterThirtyRefusedCalls", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("DISCORD_NOT_CERTIFIED", true));
    for (let i = 0; i < 30; i += 1) await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(sendDiscordDmTest).toHaveBeenCalledTimes(30);
  });

  it("post_globalBucketEmpty_returns503BusyAndRefundsAccountSlot", async () => {
    jest.mocked(sendDiscordDmTest).mockResolvedValue("DMS_CLOSED");
    for (let id = 1000; id < 1030; id += 1) {
      jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id }));
      await POST(sameSite());
    }
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));

    const refused = await POST(sameSite());

    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "DISCORD_DM_TEST_BUSY" });
    expect(sendDiscordDmTest).toHaveBeenCalledTimes(30);
    resetRateLimit("discord-dm-test-global");
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await POST(sameSite())).status);
    expect(statuses).toEqual([200, 200, 200]);
  });

  it("post_trackedAccountsFull_returns503BusyNotTooMany", async () => {
    for (let id = 100_000; id < 100_000 + DM_TEST_MAX_TRACKED_ACCOUNTS; id += 1) reserveDmTestTry(id);

    const response = await POST(sameSite());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "DISCORD_DM_TEST_BUSY" });
    expect(sendDiscordDmTest).not.toHaveBeenCalled();
  });

  it("post_sentOutcome_refundsGlobalToken", async () => {
    const statuses = [];
    for (let id = 1000; id < 1040; id += 1) {
      jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id }));
      statuses.push((await POST(sameSite())).status);
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(sendDiscordDmTest).toHaveBeenCalledTimes(40);
  });

  it("post_nothingSentError_refundsGlobalSlot", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("DISCORD_NOT_LINKED", true));
    for (let id = 1000; id < 1031; id += 1) {
      jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id }));
      await POST(sameSite());
    }
    jest.mocked(sendDiscordDmTest).mockResolvedValue("DMS_CLOSED");

    const response = await POST(sameSite());

    expect(response.status).toBe(200);
  });

  it("post_abortedAfterBotCall_returns400AndKeepsQuota", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new DmTestError("REQUEST_ABORTED", false));
    const first = await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const fourth = await POST(sameSite());

    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({ error: "REQUEST_ABORTED" });
    expect(fourth.status).toBe(429);
  });

  it("post_accountReadFailed_returns500AndRefundsQuota", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest
      .mocked(sendDiscordDmTest)
      .mockRejectedValue(new DmTestError("DISCORD_DM_TEST_FAILED", true, { cause: new Error("ECONNRESET") }));
    for (let i = 0; i < 4; i += 1) await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "DISCORD_DM_TEST_FAILED" });
    expect(sendDiscordDmTest).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenCalled();
  });

  it("post_unexpectedError_keepsQuota", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new Error("boom"));
    await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(429);
  });
});
