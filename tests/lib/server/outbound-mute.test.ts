import crypto from "node:crypto";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

/*
 * EF-62 (revue standard, cycles 2 et 3) : le rejeu des suppressions après une
 * restauration coupe tout envoi sortant du processus — bot (journal, messages
 * privés, annonces #live) et push. L'état est propre au module : chaque cas
 * charge un registre neuf (`jest.isolateModulesAsync`), l'ordre ne compte pas.
 */

type Modules = {
  mute: typeof import("@/lib/server/outbound-mute");
  bot: typeof import("@/lib/server/bot-integration");
  push: typeof import("@/lib/server/push-subscriptions");
  database: typeof import("@/lib/server/database");
};

async function freshModules(): Promise<Modules> {
  let modules: Modules | undefined;
  await jest.isolateModulesAsync(async () => {
    modules = {
      mute: await import("@/lib/server/outbound-mute"),
      bot: await import("@/lib/server/bot-integration"),
      push: await import("@/lib/server/push-subscriptions"),
      database: await import("@/lib/server/database"),
    };
  });
  if (!modules) throw new Error("modules non chargés");
  return modules;
}

const RECIPIENT = { discordId: "123456789012345678", handle: null, label: "un joueur" };

function okDeliveryResponse(): Response {
  return new Response(JSON.stringify({ sent: 1, failed: 0, failedIds: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("outbound-mute", () => {
  it("outboundMuted_freshProcess_returnsFalse", async () => {
    const { mute } = await freshModules();

    expect(mute.outboundMuted()).toBe(false);
  });

  it("outboundMuted_afterMute_returnsTrue", async () => {
    const { mute } = await freshModules();

    mute.muteOutboundForProcess();

    expect(mute.outboundMuted()).toBe(true);
  });

  it("isBotCircuitOpen_outboundMuted_returnsTrue", async () => {
    const { mute, bot } = await freshModules();
    mute.muteOutboundForProcess();

    expect(bot.isBotCircuitOpen()).toBe(true);
  });

  it("pushDiscordDirectMessages_notMuted_postsToBot", async () => {
    const { bot } = await freshModules();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(okDeliveryResponse());

    await bot.pushDiscordDirectMessages("message", [RECIPIENT], "test");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pushDiscordDirectMessages_outboundMuted_returnsNullWithoutFetch", async () => {
    const { mute, bot } = await freshModules();
    mute.muteOutboundForProcess();
    const fetchMock = jest.spyOn(global, "fetch");

    const report = await bot.pushDiscordDirectMessages("message", [RECIPIENT], "test");

    expect(report).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendBotLog_outboundMuted_neverPostsToBot", async () => {
    const { mute, bot } = await freshModules();
    mute.muteOutboundForProcess();
    const fetchMock = jest.spyOn(global, "fetch");

    bot.sendBotLog("ligne d'alerte", { category: "referees" });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushLiveAnnouncement_outboundMuted_unavailableWithoutFetch", async () => {
    const { mute, bot } = await freshModules();
    mute.muteOutboundForProcess();
    const fetchMock = jest.spyOn(global, "fetch");

    const outcome = await bot.pushLiveAnnouncement("Alpha contre Beta", "https://twitch.tv/bg", "test");

    expect(outcome).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushToUsers_outboundMuted_returnsZeroWithoutQuery", async () => {
    const { mute, push, database } = await freshModules();
    mute.muteOutboundForProcess();
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

    const pushed = await push.pushToUsers(
      [7],
      "MATCH_START",
      () => ({ title: "t", body: "b", url: "/" }),
      {},
      { publicKey: "cle", privateKey, subject: "mailto:test@example.invalid" },
    );

    expect(pushed).toBe(0);
    expect(database.getDatabase).not.toHaveBeenCalled();
  });
});
