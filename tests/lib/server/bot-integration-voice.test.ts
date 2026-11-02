import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { countVoiceChannel, ensureVoiceChannel, releaseVoiceChannel } from "@/lib/server/bot-integration";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("bot-integration — salons vocaux", () => {
  it("ensureVoiceChannel_created_sendsKeyAndNameAndReturnsChannelId", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(json(201, { channelId: "123456789" }));

    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({ kind: "ok", value: "123456789" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/internal\/voice\/channels$/);
    expect(JSON.parse(String(init?.body))).toEqual({ key: "match:42:team:1", name: "Alpha" });
  });

  it("ensureVoiceChannel_missingPermissions_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(503, { error: "VOICE_MISSING_PERMISSIONS" }));
    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({
      kind: "failed",
      code: "VOICE_MISSING_PERMISSIONS",
    });
  });

  it("countVoiceChannel_ok_returnsMembers", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(200, { members: 4 }));
    await expect(countVoiceChannel("123456789")).resolves.toEqual({ kind: "ok", value: 4 });
  });

  it("countVoiceChannel_notFound_returnsGone", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "VOICE_CHANNEL_NOT_FOUND" }));
    await expect(countVoiceChannel("123456789")).resolves.toEqual({ kind: "gone", code: "VOICE_CHANNEL_NOT_FOUND" });
  });

  it("countVoiceChannel_badPayload_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(200, { members: -1 }));
    await expect(countVoiceChannel("123456789")).resolves.toEqual({ kind: "failed", code: "BOT_VOICE_BAD_RESPONSE" });
  });

  it("releaseVoiceChannel_notTracked_returnsGone", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "VOICE_CHANNEL_NOT_TRACKED" }));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });
  });

  it("releaseVoiceChannel_unreachable_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
  });
});
