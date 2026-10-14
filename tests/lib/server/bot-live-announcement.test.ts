import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { isBotCircuitOpen, pushLiveAnnouncement, type LiveAnnouncementOutcome } from "@/lib/server/bot-integration";

/** `pushLiveAnnouncement` : contrat avec `POST /internal/announce/live` du bot. */

const originalEnv = { ...process.env };

/** Une publication réussie remet le coupe-circuit à zéro entre deux échecs simulés. */
async function succeedOnce(): Promise<void> {
  jest.spyOn(global, "fetch").mockResolvedValueOnce(Response.json({ ok: true }));
  await pushLiveAnnouncement("x", "https://twitch.tv/bg", "c");
}

describe("pushLiveAnnouncement", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BOT_INTERNAL_URL;
    delete process.env.BOT_INTERNAL_HOST;
    delete process.env.BOT_INTERNAL_PORT;
    process.env.BOT_INTERNAL_TOKEN = "jeton";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("poste le texte, le lien et le contexte avec le jeton interne", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(Response.json({ posted: true, mentionEveryone: true }));

    await expect(pushLiveAnnouncement("Alpha contre Beta", "https://twitch.tv/bg", "live-announce match-4")).resolves.toBe(
      "posted",
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4400/internal/announce/live");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(expect.objectContaining({ "x-internal-token": "jeton" }));
    expect(JSON.parse(String(init?.body))).toEqual({
      message: "Alpha contre Beta",
      streamUrl: "https://twitch.tv/bg",
      context: "live-announce match-4",
    });
  });

  it("rend « posted-silent » quand le bot a publié sans pouvoir mentionner @everyone", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(Response.json({ posted: true, mentionEveryone: false, embedLinks: true }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("posted-silent");
  });

  it("rend « posted » sur un bilan illisible : la publication a eu lieu", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("posted");
  });

  it("rend « rejected » sur un 400, sans compter une panne", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ error: "INVALID_LIVE_ANNOUNCEMENT" }, { status: 400 }));
    for (let i = 0; i < 4; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("rejected");
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("relâche le corps d'une réponse qu'il ne lit pas (404, 500, 400) : la connexion revient au pool", async () => {
    // Le 400 en dernier : il compte un succès, le 500 ne laisse pas le coupe-circuit entamé.
    for (const status of [404, 500, 400]) {
      const response = new Response("ignoré", { status });
      const cancel = jest.spyOn(response.body!, "cancel");
      jest.spyOn(global, "fetch").mockResolvedValue(response);
      await pushLiveAnnouncement("x", "https://twitch.tv/bg", "c");
      expect(cancel).toHaveBeenCalled();
    }
  });

  it("rend « unavailable » sur un bot antérieur (404) sans ouvrir le coupe-circuit", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    for (let i = 0; i < 4; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unavailable");
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("classe un 503 par sa raison : AutoMod, autre refus, envoi incertain", async () => {
    const cases: [string, string][] = [
      ["automod", "discord-refused"],
      // Refus lié à l'état du salon : il peut se régler, le site réessaie.
      ["send-rejected", "discord-held"],
      // Discord muet en lisant le salon : panne qui touche tout envoi.
      ["discord-unreachable", "discord-unreachable"],
      // Discord a lâché pendant l'envoi : le message a pu partir, pas de nouvel essai.
      ["discord-down", "uncertain"],
    ];
    for (const [reason, outcome] of cases) {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE", reason }, { status: 503 }));
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe(outcome);
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("rend « discord-unreachable » sur une panne de Discord en lisant le salon, sans ouvrir le coupe-circuit", async () => {
    for (const reason of ["discord-unreachable"]) {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE", reason }, { status: 503 }));
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("discord-unreachable");
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("un autre 503 du bot (configuration) n'accuse pas le salon #live", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ error: "PANNE" }, { status: 503 }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unavailable");
    // Un bot antérieur, sans raison : salon fermé, comme avant.
    jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE" }, { status: 503 }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("channel-closed");
  });

  it("rend « unauthorized » sur un jeton refusé (401) ou absent du bot, sans ouvrir le coupe-circuit", async () => {
    for (let i = 0; i < 4; i++) {
      jest.spyOn(global, "fetch").mockResolvedValueOnce(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }));
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unauthorized");
    }
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "INTERNAL_API_TOKEN_NOT_CONFIGURED" }, { status: 503 }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unauthorized");
    // Une configuration fausse ne suspend pas les rappels et alertes de fond.
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("un 503 au corps illisible garde la réservation : il pouvait dire « discord-down »", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response("{\"error\":\"LIVE_CHAN", { status: 503 }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("uncertain");
    // Délai écoulé en lisant le corps : le bot a pu publier, ou publie encore.
    const timedOut = new Response("{}", { status: 503 });
    jest.spyOn(timedOut, "json").mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    jest.spyOn(global, "fetch").mockResolvedValueOnce(timedOut);
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("timed-out");
  });

  it("rend « channel-closed » pour une raison de salon ou de permission", async () => {
    for (const reason of ["missing", "no-view", "no-send", "send-denied"]) {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE", reason }, { status: 503 }));
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("channel-closed");
    }
  });

  it("rend « channel-closed » sur un salon fermé (503) sans ouvrir le coupe-circuit des autres appels", async () => {
    jest
      .spyOn(global, "fetch")
      // Un corps neuf à chaque appel : une réponse ne se lit qu'une fois.
      .mockImplementation(async () => Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE" }, { status: 503 }));
    for (let i = 0; i < 4; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("channel-closed");
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("rend « timed-out » sur un délai dépassé : le bot a pu publier, ou publie encore", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    for (let i = 0; i < 4; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("timed-out");
    }
    // Des envois lents dans #live ne suspendent pas le trafic de fond.
    expect(isBotCircuitOpen()).toBe(false);
  });

  // Connexion coupée en route : le bot a pu publier avant de tomber. Connexion
  // qui n'a pas abouti : rien n'est parti.
  const TRANSPORT_FAILURES: [string, LiveAnnouncementOutcome][] = [
    ["ECONNRESET", "interrupted"],
    ["UND_ERR_SOCKET", "interrupted"],
    ["EPIPE", "interrupted"],
    ["ECONNREFUSED", "unavailable"],
    ["ENOTFOUND", "unavailable"],
    ["UND_ERR_CONNECT_TIMEOUT", "unavailable"],
  ];
  it.each(TRANSPORT_FAILURES)("connexion en échec %s : « %s »", async (code, expected) => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: Object.assign(new Error("échec"), { code }) }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe(expected);
    await succeedOnce();
  });

  it("rend « unavailable » sur une erreur interne du bot (500) : elle naît avant l'envoi", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ error: "LIVE_ANNOUNCEMENT_FAILED" }, { status: 500 }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unavailable");
    await succeedOnce();
  });

  it("rend « unavailable » sur un bot injoignable, puis court-circuite", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    for (let i = 0; i < 3; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unavailable");
    }
    expect(isBotCircuitOpen()).toBe(true);

    // Coupe-circuit ouvert : plus aucun appel.
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
