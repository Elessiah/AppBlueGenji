import { describe, expect, it } from "@jest/globals";
import { botLogBatchKey, packBotLogLines } from "@/lib/shared/bot-log-batch";
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
});

describe("botLogBatchKey", () => {
  it("botLogBatchKey_tournamentId_scopedToChannelAndTournament", () => {
    expect(botLogBatchKey("log", 12)).toBe("log:tournament:12");
  });

  it("botLogBatchKey_noTournament_globalKeyOfTheChannel", () => {
    expect(botLogBatchKey("log")).toBe("log:global");
  });

  it("botLogBatchKey_nullTournament_globalKeyOfTheChannel", () => {
    expect(botLogBatchKey("log", null)).toBe("log:global");
  });

  it("botLogBatchKey_zeroTournamentId_globalKey", () => {
    expect(botLogBatchKey("log", 0)).toBe("log:global");
  });

  it("botLogBatchKey_fractionalTournamentId_globalKey", () => {
    expect(botLogBatchKey("log", 1.5)).toBe("log:global");
  });
});
