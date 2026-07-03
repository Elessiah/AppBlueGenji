import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { POST } from "@/app/api/auth/discord/request/route";
import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { createDiscordLoginChallenge } from "@/lib/server/users-service";

jest.mock("@/lib/server/bot-integration", () => ({
  resolveDiscordUser: jest.fn(),
  sendDiscordLoginCode: jest.fn(),
}));

jest.mock("@/lib/server/users-service", () => ({
  createDiscordLoginChallenge: jest.fn(),
}));

const resolveDiscordUserMock = resolveDiscordUser as jest.MockedFunction<typeof resolveDiscordUser>;
const sendDiscordLoginCodeMock = sendDiscordLoginCode as jest.MockedFunction<typeof sendDiscordLoginCode>;
const createDiscordLoginChallengeMock =
  createDiscordLoginChallenge as jest.MockedFunction<typeof createDiscordLoginChallenge>;

function buildRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/auth/discord/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/discord/request", () => {
  beforeEach(() => {
    resolveDiscordUserMock.mockReset();
    sendDiscordLoginCodeMock.mockReset();
    createDiscordLoginChallengeMock.mockReset();
    // Par défaut, resolve renvoie l'identifiant tel quel (cas ID numérique).
    resolveDiscordUserMock.mockImplementation(async (handle: string) => handle);
  });

  it("returns 400 for an empty handle", async () => {
    const response = await POST(buildRequest({ handle: "   " }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("INVALID_DISCORD_HANDLE");
    expect(resolveDiscordUserMock).not.toHaveBeenCalled();
    expect(createDiscordLoginChallengeMock).not.toHaveBeenCalled();
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the resolved id when the code is generated and sent", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as { success: boolean; expiresAt: string; discordId: string };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.discordId).toBe("123456789012345678");
    expect(payload.expiresAt).toBe("2030-01-01T10:00:00.000Z");
    expect(sendDiscordLoginCodeMock).toHaveBeenCalledWith("123456789012345678", "123456");
  });

  it("resolves a discord tag to an id before sending the code", async () => {
    resolveDiscordUserMock.mockResolvedValue("999888777666555444");
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 2,
      code: "654321",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockResolvedValue();

    const response = await POST(buildRequest({ handle: "keryan" }));
    const payload = (await response.json()) as { success: boolean; discordId: string };

    expect(response.status).toBe(200);
    expect(payload.discordId).toBe("999888777666555444");
    expect(resolveDiscordUserMock).toHaveBeenCalledWith("keryan");
    expect(createDiscordLoginChallengeMock).toHaveBeenCalledWith("999888777666555444");
    expect(sendDiscordLoginCodeMock).toHaveBeenCalledWith("999888777666555444", "654321");
  });

  it("maps DISCORD_USER_NOT_FOUND to 404 when the tag cannot be resolved", async () => {
    resolveDiscordUserMock.mockRejectedValue(new Error("DISCORD_USER_NOT_FOUND"));

    const response = await POST(buildRequest({ handle: "unknown_tag" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("DISCORD_USER_NOT_FOUND");
    expect(createDiscordLoginChallengeMock).not.toHaveBeenCalled();
    expect(sendDiscordLoginCodeMock).not.toHaveBeenCalled();
  });

  it("maps BOT_INTERNAL_UNREACHABLE to 503", async () => {
    createDiscordLoginChallengeMock.mockResolvedValue({
      challengeId: 1,
      code: "123456",
      expiresAt: new Date("2030-01-01T10:00:00.000Z"),
    });
    sendDiscordLoginCodeMock.mockRejectedValue(new Error("BOT_INTERNAL_UNREACHABLE"));

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
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

    const response = await POST(buildRequest({ discordId: "123456789012345678" }));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toBe("DISCORD_DM_FAILED");
  });
});
