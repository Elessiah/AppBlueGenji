import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { POST } from "@/app/api/auth/discord/request/route";
import { sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { createDiscordLoginChallenge } from "@/lib/server/users-service";

jest.mock("@/lib/server/bot-integration", () => ({
  sendDiscordLoginCode: jest.fn(),
}));

jest.mock("@/lib/server/users-service", () => ({
  createDiscordLoginChallenge: jest.fn(),
}));

const sendDiscordLoginCodeMock = sendDiscordLoginCode as jest.MockedFunction<typeof sendDiscordLoginCode>;
const createDiscordLoginChallengeMock =
  createDiscordLoginChallenge as jest.MockedFunction<typeof createDiscordLoginChallenge>;

describe("POST /api/auth/discord/request", () => {
  beforeEach(() => {
    sendDiscordLoginCodeMock.mockReset();
    createDiscordLoginChallengeMock.mockReset();
  });

  it("returns 400 for an invalid discord id", async () => {
    const request = new Request("http://localhost:3000/api/auth/discord/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId: "abc" }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("INVALID_DISCORD_ID");
    expect(createDiscordLoginChallengeMock).not.toHaveBeenCalled();
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("returns 200 when the code is generated and sent", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const request = new Request("http://localhost:3000/api/auth/discord/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId: "123456789012345678" }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { success: boolean; expiresAt: string };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.expiresAt).toBe("2030-01-01T10:00:00.000Z");
    expect(sendDiscordLoginCodeMock).toHaveBeenCalledWith("123456789012345678", "123456");
  });

  it("maps BOT_INTERNAL_UNREACHABLE to 503", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("BOT_INTERNAL_UNREACHABLE"));

    const request = new Request("http://localhost:3000/api/auth/discord/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId: "123456789012345678" }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(payload.error).toBe("BOT_INTERNAL_UNREACHABLE");
  });

  it("maps DISCORD_DM_FAILED to 502", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("DISCORD_DM_FAILED"));

    const request = new Request("http://localhost:3000/api/auth/discord/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discordId: "123456789012345678" }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("DISCORD_DM_FAILED");
  });
});
