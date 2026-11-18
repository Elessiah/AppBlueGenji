import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration", () => ({ pushDiscordDirectMessages: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import {
  DM_TEST_MAX_TRACKED_ACCOUNTS,
  DmTestError,
  reserveDmTestTry,
  resetDmTestTries,
  sendDiscordDmTest,
  trackedDmTestAccounts,
} from "@/lib/server/discord-dm-test";
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

describe("sendDiscordDmTest in flight", () => {
  it("sendDiscordDmTest_tooManyPending_throwsBusyWithoutCallingBot", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    const gate: { release?: (report: { sent: number; unresolved: never[]; failed: never[] }) => void } = {};
    jest.mocked(pushDiscordDirectMessages).mockReturnValue(
      new Promise((resolve) => {
        gate.release = resolve;
      }),
    );
    const pending = Array.from({ length: 8 }, () => sendDiscordDmTest(7));
    await new Promise((resolve) => setImmediate(resolve));
    jest.mocked(pushDiscordDirectMessages).mockClear();

    await expect(sendDiscordDmTest(7)).rejects.toThrow("DISCORD_DM_TEST_BUSY");
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();

    gate.release?.({ sent: 1, unresolved: [], failed: [] });
    await Promise.all(pending);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    await expect(sendDiscordDmTest(7)).resolves.toBe("SENT");
  });
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
  it("sendDiscordDmTest_accountReadFails_throwsFailedNothingSent", async () => {
    execute.mockRejectedValue(new Error("ECONNRESET"));

    const error = await sendDiscordDmTest(7).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DmTestError);
    expect(error).toMatchObject({ message: "DISCORD_DM_TEST_FAILED", nothingSent: true });
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("sendDiscordDmTest_abortedBeforeBotCall_throwsAbortedNothingSentWithoutBotCall", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    const controller = new AbortController();
    controller.abort();

    const error = await sendDiscordDmTest(7, controller.signal).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "REQUEST_ABORTED", nothingSent: true });
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("sendDiscordDmTest_notCertified_errorSaysNothingSent", async () => {
    execute.mockResolvedValue([[certifiedRow({ discord_verified_at: null })]]);

    const error = await sendDiscordDmTest(7).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "DISCORD_NOT_CERTIFIED", nothingSent: true });
  });

  it("sendDiscordDmTest_botUnreachable_errorSaysMaybeSent", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);

    const error = await sendDiscordDmTest(7).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "BOT_INTERNAL_UNREACHABLE", nothingSent: false });
  });
});

describe("sendDiscordDmTest abort during the bot call", () => {
  it("sendDiscordDmTest_abortedDuringBotCall_rejectsAbortedAndKeepsInFlightSlotUntilBotSettles", async () => {
    execute.mockResolvedValue([[certifiedRow()]]);
    const gate: { release?: (report: { sent: number; unresolved: never[]; failed: never[] }) => void } = {};
    jest.mocked(pushDiscordDirectMessages).mockReturnValue(
      new Promise((resolve) => {
        gate.release = resolve;
      }),
    );
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const pending = controllers.map((controller) => sendDiscordDmTest(7, controller.signal).catch((caught: unknown) => caught));
    await new Promise((resolve) => setImmediate(resolve));

    controllers.forEach((controller) => controller.abort());
    const errors = await Promise.all(pending);

    expect(errors[0]).toMatchObject({ message: "REQUEST_ABORTED", nothingSent: false });
    await expect(sendDiscordDmTest(7)).rejects.toThrow("DISCORD_DM_TEST_BUSY");
    gate.release?.({ sent: 1, unresolved: [], failed: [] });
    await new Promise((resolve) => setImmediate(resolve));
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    await expect(sendDiscordDmTest(7)).resolves.toBe("SENT");
  });
});

describe("reserveDmTestTry", () => {
  const T0 = Date.parse("2026-11-18T10:00:00Z");
  const MIN = 60_000;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    resetDmTestTries();
  });
  afterEach(() => {
    resetDmTestTries();
    jest.useRealTimers();
  });

  it("reserveDmTestTry_underLimit_acceptsAndTracksAccount", () => {
    const reservation = reserveDmTestTry(7, T0);

    expect(reservation.refused).toBeNull();
    expect(trackedDmTestAccounts()).toBe(1);
  });

  it("reserveDmTestTry_fourthWithinHour_refusesWithRetryUntilOldestExpires", () => {
    reserveDmTestTry(7, T0);
    reserveDmTestTry(7, T0 + 10 * MIN);
    reserveDmTestTry(7, T0 + 20 * MIN);

    const reservation = reserveDmTestTry(7, T0 + 30 * MIN);

    expect(reservation).toEqual({ refused: "TOO_MANY", retryAfterMs: 30 * MIN });
  });

  it("reserveDmTestTry_oldestOlderThanHour_acceptsAgain", () => {
    reserveDmTestTry(7, T0);
    reserveDmTestTry(7, T0 + 55 * MIN);
    reserveDmTestTry(7, T0 + 110 * MIN);

    const reservation = reserveDmTestTry(7, T0 + 160 * MIN);

    expect(reservation.refused).toBeNull();
  });

  it("reserveDmTestTry_refundOverlappingConcurrent_removesOwnTryOnly", () => {
    const first = reserveDmTestTry(7, T0);
    reserveDmTestTry(7, T0 + 5);
    if (first.refused !== null) throw new Error("expected a reservation");

    first.refund();

    expect(reserveDmTestTry(7, T0 + 10).refused).toBeNull();
    expect(reserveDmTestTry(7, T0 + 15).refused).toBeNull();
    expect(reserveDmTestTry(7, T0 + 20).refused).toBe("TOO_MANY");
  });

  it("reserveDmTestTry_refundTwice_removesOnce", () => {
    reserveDmTestTry(7, T0);
    reserveDmTestTry(7, T0 + 1);
    const third = reserveDmTestTry(7, T0 + 2);
    if (third.refused !== null) throw new Error("expected a reservation");

    third.refund();
    third.refund();

    expect(reserveDmTestTry(7, T0 + 3).refused).toBeNull();
    expect(reserveDmTestTry(7, T0 + 4).refused).toBe("TOO_MANY");
  });

  it("reserveDmTestTry_refundOnlyTry_dropsAccount", () => {
    const only = reserveDmTestTry(7, T0);
    if (only.refused !== null) throw new Error("expected a reservation");

    only.refund();

    expect(trackedDmTestAccounts()).toBe(0);
  });

  it("reserveDmTestTry_expiryTimer_dropsAccountAfterHourWithoutRequest", () => {
    reserveDmTestTry(7);

    jest.advanceTimersByTime(60 * MIN + 1);

    expect(trackedDmTestAccounts()).toBe(0);
  });

  it("reserveDmTestTry_mapFullOfLiveAccounts_returnsBusyForNewcomer", () => {
    for (let id = 1; id <= DM_TEST_MAX_TRACKED_ACCOUNTS; id += 1) reserveDmTestTry(id, T0);

    expect(reserveDmTestTry(999_999, T0 + 1)).toEqual({ refused: "BUSY" });
    expect(reserveDmTestTry(1, T0 + 1).refused).toBeNull();
  });

  it("reserveDmTestTry_mapFullOfExpiredAccounts_prunesAndAccepts", () => {
    for (let id = 1; id <= DM_TEST_MAX_TRACKED_ACCOUNTS; id += 1) reserveDmTestTry(id, T0);

    const reservation = reserveDmTestTry(999_999, T0 + 61 * MIN);

    expect(reservation.refused).toBeNull();
    expect(trackedDmTestAccounts()).toBe(1);
  });
});
