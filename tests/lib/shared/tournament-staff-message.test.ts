import { describe, expect, it } from "@jest/globals";
import {
  formatStaffMessageDm,
  matchesStaffMessageCategories,
  normalizeStaffMessage,
  parseDiscordUserId,
  parseStaffMessageCategories,
  parseStaffMessageDraft,
  parseTournamentId,
  staffMessageDm,
  staffMessageRefusal,
  STAFF_MESSAGE_MAX_LENGTH,
  type StaffMessageDmInput,
} from "@/lib/shared/tournament-staff-message";

/** Message du staff d'un tournoi : règles pures partagées par la route et le bot. */

const input = (overrides: Partial<StaffMessageDmInput> = {}): StaffMessageDmInput => ({
  tournamentName: "Coupe d'hiver",
  message: "Check-in à 20 h",
  tournamentUrl: "https://bluegenji.test/tournois/12",
  settingsUrl: "https://bluegenji.test/profil#notifications",
  ...overrides,
});

describe("parseStaffMessageCategories", () => {
  it("parseStaffMessageCategories_allWithOthers_returnsAllOnly", () => {
    expect(parseStaffMessageCategories(["OWNERS", "ALL", "PLAYERS"])).toEqual(["ALL"]);
  });

  it("parseStaffMessageCategories_duplicatesOutOfOrder_returnsMenuOrderWithoutDuplicates", () => {
    expect(parseStaffMessageCategories(["OWNERS", "PLAYERS", "OWNERS"])).toEqual(["PLAYERS", "OWNERS"]);
  });

  it("parseStaffMessageCategories_emptyList_returnsNull", () => {
    expect(parseStaffMessageCategories([])).toBeNull();
  });

  it("parseStaffMessageCategories_unknownCategory_returnsNull", () => {
    expect(parseStaffMessageCategories(["PLAYERS", "COACHES"])).toBeNull();
  });

  it("parseStaffMessageCategories_notAList_returnsNull", () => {
    expect(parseStaffMessageCategories("ALL")).toBeNull();
  });
});

describe("parseDiscordUserId", () => {
  it.each<[string]>([["12345678901234567"], ["12345678901234567890"]])("parseDiscordUserId_snowflake_%s_accepted", (id) => {
    expect(parseDiscordUserId(id)).toBe(id);
  });

  it.each<[unknown]>([["1234567890123456"], ["123456789012345678901"], [12345678901234567], ["1234567890123456a"]])(
    "parseDiscordUserId_notASnowflake_%p_returnsNull",
    (value) => {
      expect(parseDiscordUserId(value)).toBeNull();
    },
  );
});

describe("parseTournamentId", () => {
  it.each<[unknown, number]>([[12, 12], ["12", 12], [1, 1]])("parseTournamentId_%p_returnsId", (value, expected) => {
    expect(parseTournamentId(value)).toBe(expected);
  });

  it.each<[unknown]>([[0], [-3], [1.5], ["12a"], [""], [null]])("parseTournamentId_%p_returnsNull", (value) => {
    expect(parseTournamentId(value)).toBeNull();
  });
});

describe("matchesStaffMessageCategories", () => {
  it("matchesStaffMessageCategories_soloPlayer_isAPlayer", () => {
    expect(matchesStaffMessageCategories({ roles: [], solo: true }, ["PLAYERS"])).toBe(true);
  });

  it("matchesStaffMessageCategories_soloPlayer_isNotAnOwnerManagerOrCaptain", () => {
    expect(matchesStaffMessageCategories({ roles: [], solo: true }, ["OWNERS", "MANAGERS", "CAPTAINS"])).toBe(false);
  });

  it("matchesStaffMessageCategories_tankMember_isAPlayer", () => {
    expect(matchesStaffMessageCategories({ roles: ["TANK"], solo: false }, ["PLAYERS"])).toBe(true);
  });

  it("matchesStaffMessageCategories_coachOnly_isNotAPlayer", () => {
    expect(matchesStaffMessageCategories({ roles: ["COACH"], solo: false }, ["PLAYERS"])).toBe(false);
  });

  it("matchesStaffMessageCategories_coachOnly_isReachedByAll", () => {
    expect(matchesStaffMessageCategories({ roles: ["COACH"], solo: false }, ["ALL"])).toBe(true);
  });

  it("matchesStaffMessageCategories_owner_matchesOwners", () => {
    expect(matchesStaffMessageCategories({ roles: ["OWNER", "DPS"], solo: false }, ["OWNERS"])).toBe(true);
  });

  it("matchesStaffMessageCategories_manager_doesNotMatchCaptains", () => {
    expect(matchesStaffMessageCategories({ roles: ["MANAGER"], solo: false }, ["CAPTAINS"])).toBe(false);
  });

  it("matchesStaffMessageCategories_captain_matchesCaptains", () => {
    expect(matchesStaffMessageCategories({ roles: ["CAPITAINE"], solo: false }, ["CAPTAINS"])).toBe(true);
  });
});

describe("normalizeStaffMessage", () => {
  it("normalizeStaffMessage_crlfAndPadding_unifiesLinesAndTrims", () => {
    expect(normalizeStaffMessage("  a\r\nb\rc  ")).toBe("a\nb\nc");
  });

  it("normalizeStaffMessage_notAString_returnsNull", () => {
    expect(normalizeStaffMessage(42)).toBeNull();
  });
});

describe("formatStaffMessageDm", () => {
  it("formatStaffMessageDm_french_namesTournamentQuotesTextAndOffersOptOut", () => {
    const actual = formatStaffMessageDm(input(), "fr");

    expect(actual).toBe(
      "📣 **BlueGenji — Message du staff du tournoi « Coupe d'hiver »**\n" +
        "> Check\\-in à 20 h\n" +
        "Tournoi : <https://bluegenji.test/tournois/12>\n" +
        "Tu reçois ce message parce que tu participes à ce tournoi. Tu peux couper les messages du staff des tournois dans ton profil, section Notifications : <https://bluegenji.test/profil#notifications>",
    );
  });

  it("formatStaffMessageDm_english_usesEnglishTextAndLinks", () => {
    const actual = formatStaffMessageDm(input(), "en");

    expect(actual).toContain("Message from the staff of the tournament “Coupe d'hiver”");
    expect(actual).toContain("Tournament: <https://bluegenji.test/en/tournois/12>");
  });

  it("formatStaffMessageDm_mentionsInText_areNeutralised", () => {
    const actual = formatStaffMessageDm(input({ message: "@everyone <@&123> go" }), "fr");

    expect(actual).toContain("> @\u200Beveryone \\<@\u200B&123\\> go");
  });

  it("formatStaffMessageDm_multilineText_quotesEachLine", () => {
    const actual = formatStaffMessageDm(input({ message: "ligne 1\nligne 2" }), "fr");

    expect(actual).toContain("> ligne 1\n> ligne 2");
  });

  it("formatStaffMessageDm_noSiteUrl_omitsLinksButKeepsOptOutHint", () => {
    const actual = formatStaffMessageDm(input({ tournamentUrl: null, settingsUrl: null }), "fr");

    expect(actual).not.toContain("Tournoi : <");
    expect(actual).toContain("dans « Mon profil », section Notifications, sur le site.");
  });
});

describe("staffMessageDm", () => {
  it("staffMessageDm_eachLocale_rendersThatLocale", () => {
    const dm = staffMessageDm(input());

    expect(dm("en")).toContain("Tournament:");
    expect(dm("fr")).toContain("Tournoi :");
  });
});

describe("staffMessageRefusal", () => {
  it("staffMessageRefusal_whitespaceOnly_returnsEmpty", () => {
    expect(staffMessageRefusal(input({ message: " \n " }))).toBe("STAFF_MESSAGE_EMPTY");
  });

  it("staffMessageRefusal_invisibleCharactersOnly_returnsEmpty", () => {
    expect(staffMessageRefusal(input({ message: "\u200B\u202E" }))).toBe("STAFF_MESSAGE_EMPTY");
  });

  it("staffMessageRefusal_maximumLength_accepted", () => {
    expect(staffMessageRefusal(input({ message: "a".repeat(STAFF_MESSAGE_MAX_LENGTH) }))).toBeNull();
  });

  it("staffMessageRefusal_oneOverMaximum_returnsTooLong", () => {
    expect(staffMessageRefusal(input({ message: "a".repeat(STAFF_MESSAGE_MAX_LENGTH + 1) }))).toBe("STAFF_MESSAGE_TOO_LONG");
  });

  it("staffMessageRefusal_escapingOverflowsDirectMessage_returnsTooLong", () => {
    expect(staffMessageRefusal(input({ message: "*".repeat(STAFF_MESSAGE_MAX_LENGTH) }))).toBe("STAFF_MESSAGE_TOO_LONG");
  });
});

describe("parseStaffMessageDraft", () => {
  it("parseStaffMessageDraft_valid_returnsNormalizedDraft", () => {
    const actual = parseStaffMessageDraft({ mode: "send", categories: ["OWNERS", "ALL"], message: "  Salut\r\nà tous " });

    expect(actual).toEqual({ mode: "send", categories: ["ALL"], message: "Salut\nà tous" });
  });

  it("parseStaffMessageDraft_unknownMode_returnsInvalidRequest", () => {
    expect(parseStaffMessageDraft({ mode: "count", categories: ["ALL"], message: "Salut" })).toBe("INVALID_STAFF_MESSAGE_REQUEST");
  });

  it("parseStaffMessageDraft_blankMessage_returnsEmpty", () => {
    expect(parseStaffMessageDraft({ mode: "preview", categories: ["ALL"], message: " \n " })).toBe("STAFF_MESSAGE_EMPTY");
  });

  it("parseStaffMessageDraft_noCategory_returnsInvalidCategories", () => {
    expect(parseStaffMessageDraft({ mode: "preview", categories: [], message: "Salut" })).toBe("INVALID_RECIPIENT_CATEGORIES");
  });
});
