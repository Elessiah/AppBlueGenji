import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { isBotCircuitOpen, pushLiveAnnouncement } from "@/lib/server/bot-integration";

/** `pushLiveAnnouncement` : contrat avec `POST /internal/announce/live` du bot. */

const originalEnv = { ...process.env };

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

  it("rend « unavailable » sur un bot antérieur (404) sans ouvrir le coupe-circuit", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    for (let i = 0; i < 4; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("unavailable");
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("rend « channel-closed » sur un salon fermé (503) sans ouvrir le coupe-circuit des autres appels", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE" }, { status: 503 }));
    for (let i = 0; i < 4; i++) {
      await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("channel-closed");
    }
    expect(isBotCircuitOpen()).toBe(false);
  });

  it("rend « uncertain » sur un délai dépassé : le bot a pu publier", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("uncertain");
    // Remet le compteur de pannes à zéro pour le cas suivant.
    jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ posted: true, mentionEveryone: true }));
    await expect(pushLiveAnnouncement("x", "https://twitch.tv/bg", "c")).resolves.toBe("posted");
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
