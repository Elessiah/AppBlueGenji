import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ensureVoiceChannel, releaseVoiceChannel, releaseVoiceChannelByKey } from "@/lib/server/bot-integration";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("bot-integration — salons vocaux", () => {
  it("releaseVoiceChannelByKey_released_postsKeyToKeysRouteAndReturnsOk", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(json(200, { released: true }));

    await expect(releaseVoiceChannelByKey("match:42:team:1")).resolves.toEqual({ kind: "ok", value: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/internal\/voice\/keys\/release$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ key: "match:42:team:1" });
  });

  it("releaseVoiceChannelByKey_oldBotWithoutRoute_returnsUnavailable", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }));

    await expect(releaseVoiceChannelByKey("match:42:team:1")).resolves.toEqual({
      kind: "unavailable",
      code: "INTERNAL_ROUTE_NOT_FOUND",
    });
  });

  it("ensureVoiceChannel_channelSpecificDiscordError_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(502, { error: "VOICE_DISCORD_ERROR" }));

    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({
      kind: "failed",
      code: "VOICE_DISCORD_ERROR",
    });
  });

  it("ensureVoiceChannel_discordUnavailable_returnsUnavailable", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(503, { error: "VOICE_DISCORD_UNAVAILABLE" }));

    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({
      kind: "unavailable",
      code: "VOICE_DISCORD_UNAVAILABLE",
    });
  });

  it("ensureVoiceChannel_created_sendsKeyAndNameAndReturnsChannelId", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(json(201, { channelId: "123456789" }));

    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({ kind: "ok", value: "123456789" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/internal\/voice\/channels$/);
    expect(JSON.parse(String(init?.body))).toEqual({ key: "match:42:team:1", name: "Alpha" });
  });

  it("ensureVoiceChannel_missingPermissions_returnsUnavailable", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(503, { error: "VOICE_MISSING_PERMISSIONS" }));
    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({
      kind: "unavailable",
      code: "VOICE_MISSING_PERMISSIONS",
    });
  });

  it("releaseVoiceChannel_notTracked_returnsGone", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "VOICE_CHANNEL_NOT_TRACKED" }));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });
  });

  // Module neuf à chaque test : coupe-circuit fermé.
  it("releaseVoiceChannel_routeMissing404_returnsFailed", async () => {
    const bot = await freshBotIntegration();
    // Bot d'une autre version sans la route : jamais « déjà rendu », la ligne reste ouverte.
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }));
    await expect(bot.releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "unavailable", code: "INTERNAL_ROUTE_NOT_FOUND" });
  });

  it("releaseVoiceChannel_unreadable404_returnsRequestFailedCode", async () => {
    const bot = await freshBotIntegration();
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("<html>Cannot POST</html>", { status: 404 }));
    await expect(bot.releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
  });

  it("releaseVoiceChannel_foreignNotFound404_returnsRequestFailedCode", async () => {
    const bot = await freshBotIntegration();
    // Le 404 d'un autre service (bot mal routé) : un code de transport, qui arrête le balayage.
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "NOT_FOUND" }));
    await expect(bot.releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
  });

  it("releaseVoiceChannel_sentenceErrorCode_returnsRequestFailedCode", async () => {
    const bot = await freshBotIntegration();
    // Une phrase (qui pourrait citer un salon ou un membre) n'est jamais reprise comme code.
    jest.spyOn(global, "fetch").mockResolvedValue(json(503, { error: "Salon Equipe Bleue introuvable" }));
    await expect(bot.releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
  });

  it("releaseVoiceChannel_nonStringErrorCode_returnsFallbackCode", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(500, { error: { code: "X" } }));
    const outcome = await releaseVoiceChannel("123456789");
    // Ni TypeError, ni panne de transport inventée : un code en chaîne (réponse illisible du bot entier).
    expect(outcome).toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
    expect(outcome).not.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_UNREACHABLE" });
    expect(typeof (outcome as { code: unknown }).code).toBe("string");
  });

  it("releaseVoiceChannel_unreadable500_returnsRequestFailedCode", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    // La page du proxy n'est jamais recopiée comme code.
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
  });

  it("releaseVoiceChannel_unreachable_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(releaseVoiceChannel("123456789")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_UNREACHABLE" });
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

  it("releaseVoiceChannel_threeRouteMissing404s_doesNotOpenCircuit", async () => {
    const bot = await freshBotIntegration();
    // Écart de version des seules routes vocales : le journal et les annonces restent servis.
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }));
    for (let call = 0; call < 3; call++) await bot.releaseVoiceChannel("123456789");
    expect(bot.isBotCircuitOpen()).toBe(false);
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
