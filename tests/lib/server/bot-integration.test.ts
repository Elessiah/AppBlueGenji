import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fetchBotStats, sendDiscordLoginCode } from "@/lib/server/bot-integration";

const originalEnv = { ...process.env };

describe("bot-integration", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BOT_INTERNAL_URL;
    delete process.env.BOT_INTERNAL_HOST;
    delete process.env.BOT_INTERNAL_PORT;
    delete process.env.BOT_INTERNAL_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("uses localhost fallback URL when BOT_INTERNAL_URL is missing", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await sendDiscordLoginCode("123456789", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4400/internal/auth/send-code",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses BOT_INTERNAL_HOST and BOT_INTERNAL_PORT fallback values", async () => {
    process.env.BOT_INTERNAL_HOST = "10.10.10.7";
    process.env.BOT_INTERNAL_PORT = "4510";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await sendDiscordLoginCode("123456789", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://10.10.10.7:4510/internal/auth/send-code",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws BOT_INTERNAL_UNREACHABLE when bot API cannot be reached", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(sendDiscordLoginCode("123456789", "123456")).rejects.toThrow("BOT_INTERNAL_UNREACHABLE");
  });

  it("throws BOT_INTERNAL_UNAUTHORIZED on 401", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(sendDiscordLoginCode("123456789", "123456")).rejects.toThrow("BOT_INTERNAL_UNAUTHORIZED");
  });

  it("throws DISCORD_DM_FAILED when bot reports DM failure", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "DISCORD_DM_FAILED" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(sendDiscordLoginCode("123456789", "123456")).rejects.toThrow("DISCORD_DM_FAILED");
  });

  it("returns empty stats when stats endpoint fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const stats = await fetchBotStats();
    expect(stats).toEqual({
      affiliatedServers: 0,
      affiliatedChannels: 0,
      messagesLast30Days: 0,
      relayedMessagesLast30Days: 0,
      uniqueUsersLast30Days: 0,
    });
  });
});
