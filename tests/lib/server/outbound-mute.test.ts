import crypto from "node:crypto";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushDiscordDirectMessages, sendBotLog } from "@/lib/server/bot-integration";
import { muteOutboundForProcess, outboundMuted } from "@/lib/server/outbound-mute";
import { pushToUsers } from "@/lib/server/push-subscriptions";

/*
 * EF-62 (revue standard, cycle 2) : le rejeu des suppressions après une
 * restauration coupe tout envoi sortant du processus — bot et push.
 * L'ordre compte : le premier cas lit l'état par défaut, les suivants coupent.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

describe("outbound-mute", () => {
  it("outboundMuted_default_returnsFalse", () => {
    expect(outboundMuted()).toBe(false);
  });

  it("isBotCircuitOpen_outboundMuted_returnsTrue", () => {
    muteOutboundForProcess();

    expect(isBotCircuitOpen()).toBe(true);
  });

  it("sendBotLog_outboundMuted_neverPostsToBot", async () => {
    muteOutboundForProcess();
    const fetchMock = jest.spyOn(global, "fetch");

    sendBotLog("ligne d'alerte", { category: "referees" });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushDiscordDirectMessages_outboundMuted_returnsNullWithoutFetch", async () => {
    muteOutboundForProcess();
    const fetchMock = jest.spyOn(global, "fetch");

    const report = await pushDiscordDirectMessages(
      "message",
      [{ discordId: "123456789012345678", handle: null, label: "un joueur" }],
      "test",
    );

    expect(report).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushToUsers_outboundMuted_returnsZeroWithoutQuery", async () => {
    muteOutboundForProcess();
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

    const pushed = await pushToUsers(
      [7],
      "MATCH_START",
      () => ({ title: "t", body: "b", url: "/" }),
      {},
      { publicKey: "cle", privateKey, subject: "mailto:test@example.invalid" },
    );

    expect(pushed).toBe(0);
    expect(getDatabase).not.toHaveBeenCalled();
  });
});
