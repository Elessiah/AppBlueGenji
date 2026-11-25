import { describe, expect, it } from "@jest/globals";
import {
  initialStaffMessageCategories,
  staffMessageBlocker,
  staffMessageLength,
  staffMessageLinkBase,
  staffMessageRenderedTooLong,
  staffMessageRequestCategories,
  staffMessageSendMayHaveGoneOut,
  staffMessageSendOutcome,
  toggleStaffMessageCategory,
} from "@/app/(secured)/tournois/[id]/_lib/staff-message-dialog";
import { STAFF_MESSAGE_MAX_LENGTH, type StaffMessageCategory } from "@/lib/shared/tournament-staff-message";

/** Fenêtre « Message aux participants » : cases des catégories et retenue de l'envoi. */

const set = (...categories: StaffMessageCategory[]) => new Set<StaffMessageCategory>(categories);
const counts = { total: 3, reachable: 2, withoutDiscord: 1, optedOut: 0 };

describe("toggleStaffMessageCategory", () => {
  it("toggleStaffMessageCategory_tickAll_selectsEverything", () => {
    expect(toggleStaffMessageCategory(set("OWNERS"), "ALL", true)).toEqual(initialStaffMessageCategories());
  });

  it("toggleStaffMessageCategory_untickAll_clearsEverything", () => {
    expect(toggleStaffMessageCategory(initialStaffMessageCategories(), "ALL", false)).toEqual(set());
  });

  it("toggleStaffMessageCategory_untickOne_dropsAll", () => {
    expect(toggleStaffMessageCategory(initialStaffMessageCategories(), "MANAGERS", false)).toEqual(
      set("PLAYERS", "CAPTAINS", "OWNERS"),
    );
  });

  it("toggleStaffMessageCategory_tickLastMissing_addsAll", () => {
    expect(toggleStaffMessageCategory(set("PLAYERS", "MANAGERS", "CAPTAINS"), "OWNERS", true)).toEqual(
      initialStaffMessageCategories(),
    );
  });
});

describe("staffMessageRequestCategories", () => {
  it("staffMessageRequestCategories_allTicked_sendsAllOnly", () => {
    expect(staffMessageRequestCategories(initialStaffMessageCategories())).toEqual(["ALL"]);
  });

  it("staffMessageRequestCategories_someTicked_sendsMenuOrder", () => {
    expect(staffMessageRequestCategories(set("OWNERS", "PLAYERS"))).toEqual(["PLAYERS", "OWNERS"]);
  });
});

describe("staffMessageBlocker", () => {
  it("staffMessageBlocker_noCategory_returnsNoCategory", () => {
    expect(staffMessageBlocker({ message: "Salut", categories: set(), counts })).toBe("noCategory");
  });

  it("staffMessageBlocker_blankMessage_returnsEmpty", () => {
    expect(staffMessageBlocker({ message: "  \n ", categories: set("ALL"), counts })).toBe("empty");
  });

  it("staffMessageBlocker_overMaxLength_returnsTooLong", () => {
    expect(staffMessageBlocker({ message: "a".repeat(STAFF_MESSAGE_MAX_LENGTH + 1), categories: set("ALL"), counts })).toBe("tooLong");
  });

  it("staffMessageBlocker_exactlyMaxLength_isReady", () => {
    expect(staffMessageBlocker({ message: "a".repeat(STAFF_MESSAGE_MAX_LENGTH), categories: set("ALL"), counts })).toBeNull();
  });

  it("staffMessageBlocker_countPending_returnsCounting", () => {
    expect(staffMessageBlocker({ message: "Salut", categories: set("ALL"), counts: null })).toBe("counting");
  });

  it("staffMessageBlocker_everyoneOptedOut_returnsNobody", () => {
    const optedOut = { total: 2, reachable: 0, withoutDiscord: 0, optedOut: 2 };

    expect(staffMessageBlocker({ message: "Salut", categories: set("ALL"), counts: optedOut })).toBe("nobody");
  });

  it("staffMessageBlocker_pushOnlyRecipient_isReady", () => {
    const pushOnly = { total: 1, reachable: 0, withoutDiscord: 1, optedOut: 0 };

    expect(staffMessageBlocker({ message: "Salut", categories: set("OWNERS"), counts: pushOnly })).toBeNull();
  });
});

describe("staffMessageLength", () => {
  it("staffMessageLength_emojiAndSpaces_countsTrimmedCodePoints", () => {
    expect(staffMessageLength("  🎮 GG  ")).toBe(4);
  });
});

describe("staffMessageRenderedTooLong", () => {
  const tournament = { id: 12, name: "Coupe d'hiver" };

  it("staffMessageRenderedTooLong_shortText_returnsFalse", () => {
    expect(staffMessageRenderedTooLong("Check-in à 20 h", tournament, "https://bluegenji.test")).toBe(false);
  });

  it("staffMessageRenderedTooLong_underMaxButEscapedOverDmCap_returnsTrue", () => {
    expect(staffMessageRenderedTooLong("*".repeat(1000), tournament, "https://bluegenji.test")).toBe(true);
  });
});

describe("staffMessageRenderedTooLong — racine des liens", () => {
  const tournament = { id: 12, name: "Coupe d'hiver" };

  it("staffMessageRenderedTooLong_nullLinkBase_measuresWithoutLinks", () => {
    expect(staffMessageRenderedTooLong("*".repeat(738), tournament, null)).toBe(false);
  });

  it("staffMessageRenderedTooLong_sameTextWithLinks_returnsTrue", () => {
    expect(staffMessageRenderedTooLong("*".repeat(738), tournament, "https://bluegenji.test")).toBe(true);
  });
});

describe("staffMessageLinkBase", () => {
  it("staffMessageLinkBase_url_returnsItWithoutTrailingSlash", () => {
    expect(staffMessageLinkBase("https://bluegenji.test/")).toBe("https://bluegenji.test");
  });

  it("staffMessageLinkBase_urlWithoutTrailingSlash_returnsItUnchanged", () => {
    expect(staffMessageLinkBase("https://bluegenji.test")).toBe("https://bluegenji.test");
  });

  it("staffMessageLinkBase_urlWithSeveralTrailingSlashes_stripsThemAll", () => {
    expect(staffMessageLinkBase("https://bluegenji.test///")).toBe("https://bluegenji.test");
  });

  it("staffMessageLinkBase_null_returnsNull", () => {
    expect(staffMessageLinkBase(null)).toBeNull();
  });

  it("staffMessageLinkBase_notAnHttpUrl_returnsUndefined", () => {
    expect(staffMessageLinkBase("javascript:alert(1)")).toBeUndefined();
  });

  it("staffMessageLinkBase_missing_returnsUndefined", () => {
    expect(staffMessageLinkBase(undefined)).toBeUndefined();
  });
});

describe("staffMessageBlocker — message privé rendu", () => {
  it("staffMessageBlocker_renderedTooLong_returnsTooLong", () => {
    expect(staffMessageBlocker({ message: "Salut", categories: set("ALL"), counts, renderedTooLong: true })).toBe("tooLong");
  });
});

describe("staffMessageSendOutcome", () => {
  const delivery = { sent: 2, failed: 0, unconfirmed: 0, skipped: 0, pushed: 1, botUnreachable: false, pending: false };

  it("staffMessageSendOutcome_pending_returnsPending", () => {
    expect(staffMessageSendOutcome({ ...delivery, sent: 0, pushed: 0, pending: true })).toBe("pending");
  });

  it("staffMessageSendOutcome_nothingDelivered_returnsNothingDelivered", () => {
    expect(staffMessageSendOutcome({ ...delivery, sent: 0, pushed: 0, botUnreachable: true })).toBe("nothingDelivered");
  });

  it("staffMessageSendOutcome_botUnreachableWithPush_returnsBotUnreachable", () => {
    expect(staffMessageSendOutcome({ ...delivery, sent: 0, botUnreachable: true })).toBe("botUnreachable");
  });

  it("staffMessageSendOutcome_unconfirmed_returnsUnconfirmed", () => {
    expect(staffMessageSendOutcome({ ...delivery, sent: 0, pushed: 0, unconfirmed: 3 })).toBe("unconfirmed");
  });

  it("staffMessageSendOutcome_botReachedNothingDelivered_returnsNobodyReached", () => {
    expect(staffMessageSendOutcome({ ...delivery, sent: 0, pushed: 0, failed: 2 })).toBe("nobodyReached");
  });

  it("staffMessageSendOutcome_delivered_returnsSent", () => {
    expect(staffMessageSendOutcome(delivery)).toBe("sent");
  });
});

describe("staffMessageSendMayHaveGoneOut", () => {
  it("staffMessageSendMayHaveGoneOut_unreadableOrServerError_returnsTrue", () => {
    expect([staffMessageSendMayHaveGoneOut("STAFF_MESSAGE_OUTCOME_UNKNOWN"), staffMessageSendMayHaveGoneOut("INTERNAL_ERROR")]).toEqual([true, true]);
  });

  it("staffMessageSendMayHaveGoneOut_definiteRefusal_returnsFalse", () => {
    expect(staffMessageSendMayHaveGoneOut("STAFF_MESSAGE_QUOTA_EXCEEDED")).toBe(false);
  });
});
