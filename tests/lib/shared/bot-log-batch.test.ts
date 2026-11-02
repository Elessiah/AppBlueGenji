import { describe, expect, it } from "@jest/globals";
import { botLogBatchKey, packBotLogLines } from "@/lib/shared/bot-log-batch";

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
