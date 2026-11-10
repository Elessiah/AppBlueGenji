import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { clearVoiceChannel, ensureVoiceChannel, releaseVoiceChannel, releaseVoiceChannelByKey } from "@/lib/server/bot-integration";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("bot-integration — salons vocaux", () => {
  it("clearVoiceChannel_cleared_postsToClearRouteAndReturnsOk", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(json(200, { cleared: true }));

    await expect(clearVoiceChannel("123456789012345678")).resolves.toEqual({ kind: "ok", value: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/internal\/voice\/channels\/123456789012345678\/clear$/);
    expect(init?.method).toBe("POST");
  });

  it("clearVoiceChannel_notTracked404_returnsGone", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "VOICE_CHANNEL_NOT_TRACKED" }));
    await expect(clearVoiceChannel("123456789012345678")).resolves.toEqual({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });
  });

  it("clearVoiceChannel_missingPermissions_returnsUnavailable", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(503, { error: "VOICE_MISSING_PERMISSIONS" }));
    await expect(clearVoiceChannel("123456789012345678")).resolves.toEqual({
      kind: "unavailable",
      code: "VOICE_MISSING_PERMISSIONS",
    });
  });

  it("clearVoiceChannel_answerWithoutCleared_returnsBadResponse", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(200, { released: true }));
    await expect(clearVoiceChannel("123456789012345678")).resolves.toEqual({
      kind: "unavailable",
      code: "BOT_VOICE_BAD_RESPONSE",
    });
  });

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
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(json(201, { channelId: "123456789012345678" }));

    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({ kind: "ok", value: "123456789012345678" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/internal\/voice\/channels$/);
    expect(JSON.parse(String(init?.body))).toEqual({ key: "match:42:team:1", name: "Alpha" });
  });

  it("ensureVoiceChannel_channelIdShorterThanSnowflake_notKept", async () => {
    // Le bot refuserait cet identifiant au rendu (`INVALID_CHANNEL_ID`, qui clôt la ligne) : jamais gardé.
    jest.spyOn(global, "fetch").mockResolvedValue(json(201, { channelId: "1234567890123456" }));
    const outcome = await ensureVoiceChannel("match:42:team:1", "Alpha");
    expect(outcome.kind).not.toBe("ok");
  });

  it("ensureVoiceChannel_channelIdLongerThanSnowflake_notKept", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(201, { channelId: "123456789012345678901" }));
    const outcome = await ensureVoiceChannel("match:42:team:1", "Alpha");
    expect(outcome.kind).not.toBe("ok");
  });

  it("ensureVoiceChannel_twentyDigitChannelId_kept", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(201, { channelId: "12345678901234567890" }));
    await expect(ensureVoiceChannel("match:42:team:1", "Alpha")).resolves.toEqual({ kind: "ok", value: "12345678901234567890" });
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
    await expect(releaseVoiceChannel("123456789012345678")).resolves.toEqual({ kind: "gone", code: "VOICE_CHANNEL_NOT_TRACKED" });
  });

  // Module neuf à chaque test : coupe-circuit fermé.
  it("releaseVoiceChannel_routeMissing404_returnsFailed", async () => {
    // Bot d'une autre version sans la route : jamais « déjà rendu », la ligne reste ouverte.
    await expect(freshRelease("id", json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }))).resolves.toEqual(ROUTE_MISSING);
  });

  it("releaseVoiceChannel_unreadable404_returnsRequestFailedCode", async () => {
    await expect(freshRelease("id", htmlNotFound())).resolves.toEqual(REQUEST_FAILED);
  });

  it("releaseVoiceChannelByKey_unreadable404_returnsRouteMissing", async () => {
    // Mandataire ou bot sans la route qui répond une page HTML : refus de cette ligne seulement.
    await expect(freshRelease("key", htmlNotFound())).resolves.toEqual(ROUTE_MISSING);
  });

  it("releaseVoiceChannelByKey_foreignNotFound404_returnsRouteMissing", async () => {
    await expect(freshRelease("key", json(404, { error: "NOT_FOUND" }))).resolves.toEqual(ROUTE_MISSING);
  });

  it("releaseVoiceChannelByKey_notTracked404_returnsGone", async () => {
    await expect(freshRelease("key", json(404, { error: "VOICE_CHANNEL_NOT_TRACKED" }))).resolves.toEqual({
      kind: "gone",
      code: "VOICE_CHANNEL_NOT_TRACKED",
    });
  });

  it("releaseVoiceChannel_foreignNotFound404_returnsRequestFailedCode", async () => {
    // Le 404 d'un autre service (bot mal routé) : un code de transport, qui arrête le balayage.
    await expect(freshRelease("id", json(404, { error: "NOT_FOUND" }))).resolves.toEqual(REQUEST_FAILED);
  });

  it("releaseVoiceChannel_sentenceErrorCode_returnsRequestFailedCode", async () => {
    // Une phrase (qui pourrait citer un salon ou un membre) n'est jamais reprise comme code.
    await expect(freshRelease("id", json(503, { error: "Salon Equipe Bleue introuvable" }))).resolves.toEqual(REQUEST_FAILED);
  });

  it("releaseVoiceChannel_nonStringErrorCode_returnsFallbackCode", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(json(500, { error: { code: "X" } }));
    const outcome = await releaseVoiceChannel("123456789012345678");
    // Ni TypeError, ni panne de transport inventée : un code en chaîne (réponse illisible du bot entier).
    expect(outcome).toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
    expect(outcome).not.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_UNREACHABLE" });
    expect(typeof (outcome as { code: unknown }).code).toBe("string");
  });

  it("releaseVoiceChannel_unreadable500_returnsRequestFailedCode", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    // La page du proxy n'est jamais recopiée comme code.
    await expect(releaseVoiceChannel("123456789012345678")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" });
  });

  it("releaseVoiceChannel_unreachable_returnsFailed", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(releaseVoiceChannel("123456789012345678")).resolves.toEqual({ kind: "unavailable", code: "BOT_INTERNAL_UNREACHABLE" });
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

const ROUTE_MISSING = { kind: "unavailable", code: "INTERNAL_ROUTE_NOT_FOUND" };
const REQUEST_FAILED = { kind: "unavailable", code: "BOT_INTERNAL_REQUEST_FAILED" };

/** Page HTML d'un mandataire ou d'un serveur sans la route. */
function htmlNotFound() {
  return new Response("<html>Cannot POST</html>", { status: 404 });
}

/** Rendu par identifiant (`id`) ou par clé (`key`) d'un module neuf, le bot répondant `response`. */
async function freshRelease(route: "id" | "key", response: Response) {
  const bot = await freshBotIntegration();
  jest.spyOn(global, "fetch").mockResolvedValue(response);
  return route === "id" ? bot.releaseVoiceChannel("123456789012345678") : bot.releaseVoiceChannelByKey("match:42:team:1");
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
    for (let call = 0; call < 4; call++) await bot.releaseVoiceChannel("123456789012345678");
    expect(bot.isBotCircuitOpen()).toBe(true);
  });

  it("releaseVoiceChannel_threeRouteMissing404s_doesNotOpenCircuit", async () => {
    const bot = await freshBotIntegration();
    // Écart de version des seules routes vocales : le journal et les annonces restent servis.
    jest.spyOn(global, "fetch").mockResolvedValue(json(404, { error: "INTERNAL_ROUTE_NOT_FOUND" }));
    for (let call = 0; call < 3; call++) await bot.releaseVoiceChannel("123456789012345678");
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
    for (let call = 0; call < 4; call++) await bot.releaseVoiceChannel("123456789012345678");
    expect(bot.isBotCircuitOpen()).toBe(false);
  });
});
