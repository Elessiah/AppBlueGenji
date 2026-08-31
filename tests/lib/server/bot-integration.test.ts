import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  fetchBotStats,
  pushDiscordDirectMessages,
  pushRefereeAlert,
  pushSiteVisitStats,
  resolveDiscordUser,
  sendDiscordLoginCode,
} from "@/lib/server/bot-integration";
import type { SiteVisitStats } from "@/lib/shared/types";

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

  it("resolveDiscordUser returns a numeric id without calling the bot", async () => {
    const fetchMock = jest.spyOn(global, "fetch");

    await expect(resolveDiscordUser("123456789012345678")).resolves.toBe("123456789012345678");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolveDiscordUser resolves a tag via the bot resolve endpoint", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ discordId: "999888777666555444", matchedBy: "tag" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(resolveDiscordUser("keryan")).resolves.toBe("999888777666555444");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4400/internal/auth/resolve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resolveDiscordUser throws DISCORD_USER_NOT_FOUND on 404", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "DISCORD_USER_NOT_FOUND" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(resolveDiscordUser("ghost")).rejects.toThrow("DISCORD_USER_NOT_FOUND");
  });

  it("resolveDiscordUser throws DISCORD_USER_NOT_FOUND when the bot returns no id", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(resolveDiscordUser("ghost")).rejects.toThrow("DISCORD_USER_NOT_FOUND");
  });

  it("resolveDiscordUser throws BOT_INTERNAL_UNREACHABLE when the bot is down", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(resolveDiscordUser("keryan")).rejects.toThrow("BOT_INTERNAL_UNREACHABLE");
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
  describe("pushSiteVisitStats", () => {
    const stats: SiteVisitStats = {
      totalVisits: 1240,
      uniqueVisitors: 310,
      visitsLast24h: 42,
      uniqueVisitorsLast24h: 20,
      visitsLast7Days: 260,
      uniqueVisitorsLast7Days: 95,
      visitsLast30Days: 900,
      uniqueVisitorsLast30Days: 240,
      identifiedVisitors: 58,
      firstVisitAt: "2026-01-05T10:00:00.000Z",
      lastVisitAt: "2026-08-18T09:30:00.000Z",
    };

    it("poste la fréquentation sur le canal interne du bot", async () => {
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));

      await pushSiteVisitStats(stats);

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:4400/internal/site-visits",
        expect.objectContaining({ method: "POST", body: JSON.stringify(stats) }),
      );
    });

    it("joint le jeton interne partagé", async () => {
      process.env.BOT_INTERNAL_TOKEN = "secret-token";
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));

      await pushSiteVisitStats(stats);

      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        headers: expect.objectContaining({ "x-internal-token": "secret-token" }),
      });
    });

    it("avale une erreur réseau : la fréquentation ne casse jamais une visite", async () => {
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(pushSiteVisitStats(stats)).resolves.toBeUndefined();
    });

    it("avale une réponse en erreur du bot", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

      await expect(pushSiteVisitStats(stats)).resolves.toBeUndefined();
    });
  });

  describe("notifications Discord", () => {
    const recipients = [{ discordId: "555000111", handle: "kiro", label: "Kiro" }];

    /** Ouvre le coupe-circuit : trois échecs consécutifs suffisent. */
    async function tripCircuit() {
      jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
      for (let i = 0; i < 3; i++) await pushSiteVisitStats({} as SiteVisitStats);
      jest.restoreAllMocks();
    }

    it("poste un message privé sur le canal interne", async () => {
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(Response.json({ sent: 1, unresolved: [], failed: [] }));

      const report = await pushDiscordDirectMessages("Rappel", recipients, "match-reminder");

      expect(report).toEqual({ sent: 1, unresolved: [], failed: [] });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:4400/internal/notify/dm",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("complète un bilan partiel du bot", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ sent: 2 }));

      expect(await pushRefereeAlert("Signalement", "issue-report")).toEqual({
        sent: 2,
        unresolved: [],
        failed: [],
      });
    });

    it("rend un bilan neuf à chaque appel — pas de tableaux partagés", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ sent: 0 }));

      const first = await pushRefereeAlert("A", "issue-report");
      const second = await pushRefereeAlert("B", "issue-report");

      expect(first?.unresolved).not.toBe(second?.unresolved);
    });

    it("n'appelle pas le bot sans destinataire", async () => {
      const fetchMock = jest.spyOn(global, "fetch");

      expect(await pushDiscordDirectMessages("Rappel", [], "match-reminder")).toEqual({
        sent: 0,
        unresolved: [],
        failed: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rend null quand le bot est injoignable", async () => {
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

      expect(await pushRefereeAlert("Signalement", "issue-report")).toBeNull();
    });

    it("court-circuite les rappels quand le bot vient d'échouer en série", async () => {
      await tripCircuit();
      const fetchMock = jest.spyOn(global, "fetch");

      expect(await pushDiscordDirectMessages("Rappel", recipients, "match-reminder")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tente quand même l'alerte arbitres : un signalement est une action de joueur", async () => {
      await tripCircuit();
      const fetchMock = jest
        .spyOn(global, "fetch")
        .mockResolvedValue(Response.json({ sent: 1, unresolved: [], failed: [] }));

      expect(await pushRefereeAlert("Signalement", "issue-report")).toEqual({
        sent: 1,
        unresolved: [],
        failed: [],
      });
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
