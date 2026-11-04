import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ensureVoiceChannel, releaseVoiceChannel } from "@/lib/server/bot-integration";

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

  it("releaseVoiceChannel_notTracked_returnsGone", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "VOICE_CHANNEL_NOT_TRACKED" }));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });
  });

  it("releaseVoiceChannel_routeMissing404_returnsFailed", async () => {
    // Bot d'une autre version sans la route : jamais « déjà rendu », la ligne reste ouverte.
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "failed", code: "INTERNAL_ROUTE_NOT_FOUND" });
  });

  it("releaseVoiceChannel_unreadable404_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("<html>Cannot POST</html>", { status: 404 }));
    await expect(releaseVoiceChannel("123456789")).resolves.toMatchObject({ kind: "failed" });
  });

  it("releaseVoiceChannel_nonStringErrorCode_returnsFallbackCode", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(500, { error: { code: "X" } }));
    const outcome = await releaseVoiceChannel("123456789");
    // Ni TypeError, ni panne de transport inventée : un refus avec un code en chaîne.
    expect(outcome.kind).toBe("failed");
    expect(outcome).not.toEqual({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
    expect(typeof (outcome as { code: unknown }).code).toBe("string");
  });

  it("releaseVoiceChannel_unreadable500_returnsRequestFailedCode", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    // La page du proxy n'est jamais recopiée comme code.
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "failed", code: "BOT_INTERNAL_REQUEST_FAILED" });
  });

  it("releaseVoiceChannel_unreachable_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "failed", code: "BOT_INTERNAL_UNREACHABLE" });
  });
});

/** Module neuf : coupe-circuit fermé, compteur d'échecs à zéro. */
async function freshBotIntegration(): Promise<typeof import("@/lib/server/bot-integration")> {
  let loaded: typeof import("@/lib/server/bot-integration") | undefined;
  await jest.isolateModulesAsync(async () => {
    loaded = await import("@/lib/server/bot-integration");
  });
  return loaded!;
}

describe("bot-integration — salons vocaux, coupe-circuit", () => {
  it("releaseVoiceChannel_routeMissing404BetweenFailures_doesNotResetCircuit", async () => {
    const bot = await freshBotIntegration();
    jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    for (let call = 0; call < 4; call++) await bot.releaseVoiceChannel("123456789");
    expect(bot.isBotCircuitOpen()).toBe(true);
  });

  it("releaseVoiceChannel_notTracked404BetweenFailures_resetsCircuit", async () => {
    const bot = await freshBotIntegration();
    jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(404, { error: "VOICE_CHANNEL_NOT_TRACKED" }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    for (let call = 0; call < 4; call++) await bot.releaseVoiceChannel("123456789");
    expect(bot.isBotCircuitOpen()).toBe(false);
  });
});
