import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/discord-dm-test", () => ({
  ...jest.requireActual<typeof import("@/lib/server/discord-dm-test")>("@/lib/server/discord-dm-test"),
  sendDiscordDmTest: jest.fn(),
}));

import { POST } from "@/app/api/profile/discord/dm-test/route";
import { getCurrentUser } from "@/lib/server/auth";
import { sendDiscordDmTest } from "@/lib/server/discord-dm-test";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/profile/discord/dm-test` : test des messages privés, plafonné par compte. */

const URL_DM_TEST = "http://localhost:3000/api/profile/discord/dm-test";
const sameSite = () => new Request(URL_DM_TEST, { method: "POST", headers: { "sec-fetch-site": "same-origin" } });

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
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
    expect(sendDiscordDmTest).toHaveBeenCalledWith(7);
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

  it("post_notCertified_returns409AndRefundsQuota", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new Error("DISCORD_NOT_CERTIFIED"));
    await POST(sameSite());
    await POST(sameSite());
    await POST(sameSite());

    const response = await POST(sameSite());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "DISCORD_NOT_CERTIFIED" });
  });

  it("post_notLinked_returns409", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new Error("DISCORD_NOT_LINKED"));

    const response = await POST(sameSite());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "DISCORD_NOT_LINKED" });
  });

  it("post_profileNotFound_returns404", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new Error("PROFILE_NOT_FOUND"));

    const response = await POST(sameSite());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "PROFILE_NOT_FOUND" });
  });

  it("post_botUnreachable_returns503AndKeepsQuota", async () => {
    jest.mocked(sendDiscordDmTest).mockRejectedValue(new Error("BOT_INTERNAL_UNREACHABLE"));
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
});
