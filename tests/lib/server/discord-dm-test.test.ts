import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration", () => ({ pushDiscordDirectMessages: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { sendDiscordDmTest } from "@/lib/server/discord-dm-test";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/** « Tester mes MP » : un seul message, au Discord rattaché et certifié du compte. */

const execute = jest.fn<SqlQuery>();
const certifiedRow = (overrides: Record<string, unknown> = {}) => ({
  discord_id: "100000000000000001",
  discord_verified_at: new Date("2026-11-01T10:00:00Z"),
  locale: "fr",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
});

describe("sendDiscordDmTest", () => {
  it("sendDiscordDmTest_certifiedLinked_sendsToDiscordIdInAccountLocaleIgnoringCircuit", async () => {
    execute.mockResolvedValue([[certifiedRow({ locale: "en" })]]);

    const outcome = await sendDiscordDmTest(7);

    expect(outcome).toBe("SENT");
    expect(pushDiscordDirectMessages).toHaveBeenCalledWith(
      "BlueGenji test message: the bot can reach you by direct message. Nothing to do.",
      [{ discordId: "100000000000000001", handle: null, label: "dm-test" }],
      "dm-test",
      { honourCircuit: false },
    );
    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it("sendDiscordDmTest_localeColumnMissing_sendsBilingual", async () => {
    execute.mockResolvedValue([[certifiedRow({ locale: undefined })]]);

    await sendDiscordDmTest(7);

    const text = jest.mocked(pushDiscordDirectMessages).mock.calls[0][0];
    expect(text).toContain("Message de test BlueGenji");
    expect(text).toContain("BlueGenji test message");
  });

  it("sendDiscordDmTest_noRow_throwsProfileNotFound", async () => {
    execute.mockResolvedValue([[]]);

    await expect(sendDiscordDmTest(7)).rejects.toThrow("PROFILE_NOT_FOUND");
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("sendDiscordDmTest_noDiscordId_throwsNotLinked", async () => {
    execute.mockResolvedValue([[certifiedRow({ discord_id: null })]]);

    await expect(sendDiscordDmTest(7)).rejects.toThrow("DISCORD_NOT_LINKED");
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("sendDiscordDmTest_notVerified_throwsNotCertified", async () => {
    execute.mockResolvedValue([[certifiedRow({ discord_verified_at: null })]]);

    await expect(sendDiscordDmTest(7)).rejects.toThrow("DISCORD_NOT_CERTIFIED");
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("sendDiscordDmTest_botReturnsNull_throwsBotUnreachable", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);

    await expect(sendDiscordDmTest(7)).rejects.toThrow("BOT_INTERNAL_UNREACHABLE");
  });

  it("sendDiscordDmTest_reportFailed_returnsDmsClosed", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 0, unresolved: [], failed: ["dm-test"] });

    await expect(sendDiscordDmTest(7)).resolves.toBe("DMS_CLOSED");
  });

  it("sendDiscordDmTest_emptyReport_throwsFailed", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 0, unresolved: [], failed: [] });

    await expect(sendDiscordDmTest(7)).rejects.toThrow("DISCORD_DM_TEST_FAILED");
  });
});
