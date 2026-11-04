import { describe, expect, it } from "@jest/globals";
import {
  botLogBatchKey,
  botLogBatchScopeOfKey,
  botLogTournamentId,
  packBotLogLines,
} from "@/lib/shared/bot-log-batch";
import { discordInline } from "@/lib/shared/discord-text";

/** Mise en messages d'un lot du journal Discord (`docs/features/LOG_BATCHING.md`). */
describe("packBotLogLines", () => {
  it("packBotLogLines_linesFit_joinedInOrderInOneMessage", () => {
    expect(packBotLogLines(["un", "deux", "trois"], 100)).toEqual(["un\ndeux\ntrois"]);
  });

  it("packBotLogLines_totalExactlyAtLimit_oneMessage", () => {
    expect(packBotLogLines(["aaaa", "bbbb"], 9)).toEqual(["aaaa\nbbbb"]);
  });

  it("packBotLogLines_oneCharOverLimit_splitAtLineBoundary", () => {
    expect(packBotLogLines(["aaaa", "bbbb"], 8)).toEqual(["aaaa", "bbbb"]);
  });

  it("packBotLogLines_singleLineLongerThanLimit_cutIntoPieces", () => {
    expect(packBotLogLines(["abcdefg"], 3)).toEqual(["abc", "def", "g"]);
  });

  it("packBotLogLines_blankLines_ignored", () => {
    expect(packBotLogLines(["  ", "un", ""], 100)).toEqual(["un"]);
  });

  it("packBotLogLines_onlyBlankLines_noMessage", () => {
    expect(packBotLogLines(["", "   "], 100)).toEqual([]);
  });

  it("packBotLogLines_astralCharacters_neverSplitInHalf", () => {
    expect(packBotLogLines(["🏆🏆🏆"], 3)).toEqual(["🏆", "🏆", "🏆"]);
  });

  it("packBotLogLines_defaultLimit_staysUnderDiscordLimitWithBotPrefix", () => {
    const messages = packBotLogLines(Array.from({ length: 5 }, () => "x".repeat(600)));
    expect(messages.map((message) => message.length)).toEqual([1802, 1201]);
  });
  it("packBotLogLines_multiRowEntryOverLimit_splitBetweenRows", () => {
    expect(packBotLogLines(["aaaa\nbbbb\ncccc"], 9)).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  it("packBotLogLines_cutFallsRightAfterEscapeBackslash_backslashCarriedToNextPiece", () => {
    expect(packBotLogLines(["abc\\<@&1>"], 4)).toEqual(["abc", "\\<@&", "1>"]);
  });

  it("packBotLogLines_evenBackslashRunAtCut_cutWithoutCarry", () => {
    expect(packBotLogLines(["ab\\\\cd"], 4)).toEqual(["ab\\\\", "cd"]);
  });

  it("packBotLogLines_escapedRoleMentionAtTheDefaultCut_nextMessageStaysEscaped", () => {
    const mention = discordInline("<@&123>");
    const messages = packBotLogLines(["x".repeat(1891) + mention]);
    expect(messages).toEqual(["x".repeat(1891), `(suite)\n${mention}`]);
    expect(mention.startsWith("\\<")).toBe(true);
  });

  it("packBotLogLines_quotedRowsSplitAtTheDefaultLimit_continuationOpensOnTheLead", () => {
    const quoted = "> " + "y".repeat(1000);
    const messages = packBotLogLines([`🚩 Signalement :\n${quoted}\n${quoted}`]);
    expect(messages).toEqual([`🚩 Signalement :\n${quoted}`, `(suite)\n${quoted}`]);
  });

  it("packBotLogLines_hardCutAtTheDefaultLimit_everyContinuationOpensOnTheLead", () => {
    const messages = packBotLogLines(["z".repeat(4000)]);
    expect(messages).toEqual(["z".repeat(1892), `(suite)\n${"z".repeat(1892)}`, `(suite)\n${"z".repeat(216)}`]);
  });

  it("packBotLogLines_lineAfterASplitLine_joinsTheContinuationMessage", () => {
    const messages = packBotLogLines(["z".repeat(1901), "ok"]);
    expect(messages).toEqual(["z".repeat(1892), "(suite)\nzzzzzzzzz\nok"]);
  });

  it("packBotLogLines_lineAtExactlyTheDefaultLimit_sentWholeWithoutLead", () => {
    expect(packBotLogLines(["z".repeat(1900)])).toEqual(["z".repeat(1900)]);
  });

  it("packBotLogLines_quotedRowOverLimit_eachContinuationQuoted", () => {
    expect(packBotLogLines(["> " + "y".repeat(20)], 10)).toEqual(["> yyyyyyyy", "> yyyyyyyy", "> yyyy"]);
  });

  it("packBotLogLines_quotedRowWithTinyLimit_plainCutWithoutPrefix", () => {
    expect(packBotLogLines(["> abcdef"], 4)).toEqual(["> ab", "cdef"]);
  });

  it("packBotLogLines_indentedLine_indentationKept", () => {
    expect(packBotLogLines(["  • détail"], 100)).toEqual(["  • détail"]);
  });

  it("packBotLogLines_trailingBlanksAndLeadingEmptyRows_dropped", () => {
    expect(packBotLogLines(["\n  • détail  \n"], 100)).toEqual(["  • détail"]);
  });

  it("packBotLogLines_cutInsideAWord_backsOffToTheLastBlank", () => {
    expect(packBotLogLines(["aaa bbbbb"], 7)).toEqual(["aaa", "bbbbb"]);
  });

  it("packBotLogLines_quotedRowWithAddress_addressNeverTruncated", () => {
    expect(packBotLogLines(["> voir https://x.io/a"], 16)).toEqual(["> voir", "> https://x.io/a"]);
  });
});

describe("botLogTournamentId", () => {
  it("botLogTournamentId_numericString_parsed", () => {
    expect(botLogTournamentId("12")).toBe(12);
  });

  it("botLogTournamentId_nonNumericString_null", () => {
    expect(botLogTournamentId("12abc")).toBeNull();
  });

  it("botLogTournamentId_negativeString_null", () => {
    expect(botLogTournamentId("-3")).toBeNull();
  });

  it("botLogTournamentId_zeroString_null", () => {
    expect(botLogTournamentId("0")).toBeNull();
  });

  it("botLogTournamentId_undefined_null", () => {
    expect(botLogTournamentId(undefined)).toBeNull();
  });
});

describe("botLogBatchScopeOfKey", () => {
  it("botLogBatchScopeOfKey_tournamentKey_categoryDropped", () => {
    expect(botLogBatchScopeOfKey(botLogBatchKey("log", 12, "maps"))).toBe("log:tournament:12");
  });

  it("botLogBatchScopeOfKey_globalKey_categoryDropped", () => {
    expect(botLogBatchScopeOfKey(botLogBatchKey("log", null, "moderation"))).toBe("log:global");
  });
});

describe("botLogBatchKey", () => {
  it("botLogBatchKey_tournamentId_scopedToChannelAndTournament", () => {
    expect(botLogBatchKey("log", 12)).toBe("log:tournament:12:general");
  });

  it("botLogBatchKey_noTournament_globalKeyOfTheChannel", () => {
    expect(botLogBatchKey("log")).toBe("log:global:general");
  });

  it("botLogBatchKey_nullTournament_globalKeyOfTheChannel", () => {
    expect(botLogBatchKey("log", null)).toBe("log:global:general");
  });

  it("botLogBatchKey_zeroTournamentId_globalKey", () => {
    expect(botLogBatchKey("log", 0)).toBe("log:global:general");
  });

  it("botLogBatchKey_stringTournamentId_sameKeyAsTheNumber", () => {
    expect(botLogBatchKey("log", "12")).toBe("log:tournament:12:general");
  });

  it("botLogBatchKey_fractionalTournamentId_globalKey", () => {
    expect(botLogBatchKey("log", 1.5)).toBe("log:global:general");
  });
});
