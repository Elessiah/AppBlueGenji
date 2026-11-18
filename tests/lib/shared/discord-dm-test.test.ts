import { describe, expect, it } from "@jest/globals";
import {
  DM_TEST_MESSAGE,
  dmTestErrorToast,
  dmTestOutcome,
  dmTestOutcomeToast,
} from "@/lib/shared/discord-dm-test";
import { DM_MAX_LENGTH } from "@/lib/shared/dm-language";

/** « Tester mes MP » : issue d'un bilan du bot et notification qui la dit. */

describe("dmTestOutcome", () => {
  it("dmTestOutcome_sentPositive_returnsSent", () => {
    expect(dmTestOutcome({ sent: 1, unresolved: [], failed: [] })).toBe("SENT");
  });

  it("dmTestOutcome_failedOnly_returnsDmsClosed", () => {
    expect(dmTestOutcome({ sent: 0, unresolved: [], failed: ["dm-test"] })).toBe("DMS_CLOSED");
  });

  it("dmTestOutcome_unresolvedOnly_returnsNotInServer", () => {
    expect(dmTestOutcome({ sent: 0, unresolved: ["dm-test"], failed: [] })).toBe("NOT_IN_SERVER");
  });

  it("dmTestOutcome_emptyReport_returnsNull", () => {
    expect(dmTestOutcome({ sent: 0, unresolved: [], failed: [] })).toBeNull();
  });

  it("dmTestOutcome_failedNotArray_returnsNull", () => {
    expect(dmTestOutcome({ sent: 0, failed: null })).toBeNull();
  });

  it("dmTestOutcome_sentNotNumber_readsArrays", () => {
    expect(dmTestOutcome({ sent: "1", unresolved: ["dm-test"] })).toBe("NOT_IN_SERVER");
  });

  it("dmTestOutcome_failedAndUnresolved_returnsDmsClosed", () => {
    expect(dmTestOutcome({ sent: 0, unresolved: ["dm-test"], failed: ["dm-test"] })).toBe("DMS_CLOSED");
  });
});

describe("DM_TEST_MESSAGE", () => {
  it("DM_TEST_MESSAGE_french_returnsShortTextWithoutLink", () => {
    const text = DM_TEST_MESSAGE("fr");
    expect(text).toBe("Message de test BlueGenji : le bot peut te joindre en message privé. Rien à faire.");
    expect(text.length).toBeLessThan(DM_MAX_LENGTH);
  });

  it("DM_TEST_MESSAGE_english_returnsShortTextWithoutLink", () => {
    expect(DM_TEST_MESSAGE("en")).toBe("BlueGenji test message: the bot can reach you by direct message. Nothing to do.");
  });
});

describe("dmTestOutcomeToast", () => {
  it("dmTestOutcomeToast_sent_returnsSuccess", () => {
    expect(dmTestOutcomeToast("SENT")).toEqual({ tone: "success", key: "sent" });
  });

  it("dmTestOutcomeToast_dmsClosed_returnsError", () => {
    expect(dmTestOutcomeToast("DMS_CLOSED")).toEqual({ tone: "error", key: "dmsClosed" });
  });

  it("dmTestOutcomeToast_notInServer_returnsError", () => {
    expect(dmTestOutcomeToast("NOT_IN_SERVER")).toEqual({ tone: "error", key: "notInServer" });
  });

  it("dmTestOutcomeToast_unknownOutcome_returnsFailed", () => {
    expect(dmTestOutcomeToast(undefined)).toEqual({ tone: "error", key: "failed" });
  });
});

describe("dmTestErrorToast busy", () => {
  it("dmTestErrorToast_busy_saysBotUnreachable", () => {
    expect(dmTestErrorToast("DISCORD_DM_TEST_BUSY")).toEqual({ tone: "error", key: "botUnreachable" });
  });
});

describe("dmTestErrorToast", () => {
  it("dmTestErrorToast_notCertified_returnsNull", () => {
    expect(dmTestErrorToast("DISCORD_NOT_CERTIFIED")).toBeNull();
  });

  it("dmTestErrorToast_notLinked_returnsNotLinked", () => {
    expect(dmTestErrorToast("DISCORD_NOT_LINKED")).toEqual({ tone: "error", key: "notLinked" });
  });

  it("dmTestErrorToast_botUnreachable_returnsBotUnreachable", () => {
    expect(dmTestErrorToast("BOT_INTERNAL_UNREACHABLE")).toEqual({ tone: "error", key: "botUnreachable" });
  });

  it("dmTestErrorToast_tooManyRequests_returnsTooMany", () => {
    expect(dmTestErrorToast("TOO_MANY_REQUESTS")).toEqual({ tone: "error", key: "tooMany" });
  });

  it("dmTestErrorToast_unknownCode_returnsFailed", () => {
    expect(dmTestErrorToast("PROFILE_NOT_FOUND")).toEqual({ tone: "error", key: "failed" });
  });
});
