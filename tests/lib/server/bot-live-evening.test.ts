import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { pushLiveEvening } from "@/lib/server/bot-integration";

/** `pushLiveEvening` : annonce de soirée, public, liens et message à modifier. */

const originalEnv = { ...process.env };

const REQUEST = {
  message: "🔴 **Les lives de la soirée**\n\n**21:00** · En direct\nA contre B — T\n{{lien:1}}",
  streamUrls: ["https://www.twitch.tv/caster", "https://kick.com/autre"],
  mention: "stream-viewer" as const,
  context: "live-announce soiree-3 tournoi-4 match-40",
};

describe("pushLiveEvening", () => {
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

  it("poste public, liens (le premier en streamUrl) et message à modifier, et rend l'identifiant du message", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(Response.json({ posted: true, mentionEveryone: true, messageId: "123456789012345678", edited: true }));
    await expect(pushLiveEvening({ ...REQUEST, editMessageId: "111111111111111111" })).resolves.toEqual({
      outcome: "posted",
      messageId: "123456789012345678",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      message: REQUEST.message,
      streamUrl: "https://www.twitch.tv/caster",
      streamUrls: REQUEST.streamUrls,
      mention: "stream-viewer",
      context: REQUEST.context,
      editMessageId: "111111111111111111",
    });
  });

  it("transmet `notify: false` (nouveau message sans notification) au bot", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(Response.json({ posted: true, mentionEveryone: true, messageId: "123456789012345678", edited: false }));
    await pushLiveEvening({ ...REQUEST, notify: false });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ notify: false });
  });

  it("un bot sans identifiant de message (version antérieure), ou un identifiant illisible, rend null", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(Response.json({ posted: true, mentionEveryone: true }));
    await expect(pushLiveEvening(REQUEST)).resolves.toEqual({ outcome: "posted", messageId: null });
    jest.spyOn(global, "fetch").mockResolvedValueOnce(Response.json({ posted: true, messageId: "<@&1>" }));
    await expect(pushLiveEvening(REQUEST)).resolves.toEqual({ outcome: "posted", messageId: null });
  });

  it("garde les issues de l'annonce simple : refus, salon fermé", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(pushLiveEvening(REQUEST)).resolves.toEqual({ outcome: "rejected", messageId: null });
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "LIVE_CHANNEL_UNAVAILABLE", reason: "no-send" }, { status: 503 }));
    await expect(pushLiveEvening(REQUEST)).resolves.toEqual({ outcome: "channel-closed", messageId: null });
  });
});
