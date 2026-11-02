import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { BotLogCategory } from "@/lib/shared/bot-log-category";
import { createBotLogBatcher, type BotLogBatcher } from "@/lib/server/bot-log-batcher";
import { botLogHeader } from "@/lib/shared/bot-log-category";
import { REFEREE_DIGEST_LOG_MAX_LENGTH } from "@/lib/shared/bot-logs";

/**
 * Lots du journal Discord (`docs/features/LOG_BATCHING.md`) : silence de 5 min
 * relancé par chaque ligne (âge maximal 10 min), envoi immédiat à 5 lignes, un message par lot.
 */
const WINDOW = 5 * 60 * 1000;

type Send = (message: string, category: BotLogCategory) => Promise<void>;

let send: jest.Mock<Send>;
let batcher: BotLogBatcher;

/** Laisse la chaîne d'envois se dérouler. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  send = jest.fn<Send>(async () => undefined);
  batcher = createBotLogBatcher({ send });
});

afterEach(() => {
  batcher.reset();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("add", () => {
  it("add_oneLine_notSentBeforeTheWindowEnds", async () => {
    batcher.add("k", "ligne");
    jest.advanceTimersByTime(WINDOW - 1);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("add_oneLine_sentWhenTheWindowEnds", async () => {
    batcher.add("k", "ligne");
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send).toHaveBeenCalledWith("ligne", "general");
  });

  it("add_newLineBeforeWindowEnds_restartsTheTimer", async () => {
    batcher.add("k", "un");
    jest.advanceTimersByTime(WINDOW - 1000);
    batcher.add("k", "deux");
    jest.advanceTimersByTime(WINDOW - 1);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it("add_restartedTimerEnds_sendsBothLinesInOneMessage", async () => {
    batcher.add("k", "un");
    jest.advanceTimersByTime(WINDOW - 1000);
    batcher.add("k", "deux");
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("un\ndeux", "general");
  });

  it("add_fourthLine_stillWaits", async () => {
    for (const line of ["1", "2", "3", "4"]) batcher.add("k", line);
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(batcher.pending().get("k")).toBe(4);
  });

  it("add_fifthLine_sendsImmediatelyAsOneMessage", async () => {
    for (const line of ["1", "2", "3", "4", "5"]) batcher.add("k", line);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("1\n2\n3\n4\n5", "general");
    expect(batcher.pending().size).toBe(0);
  });

  it("add_sixthLine_opensANewBatchWithItsOwnWindow", async () => {
    for (const line of ["1", "2", "3", "4", "5", "6"]) batcher.add("k", line);
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send.mock.calls.map(([message]) => message)).toEqual(["1\n2\n3\n4\n5", "6"]);
  });

  it("add_differentKeys_capOfOneKeyLeavesTheOtherPending", async () => {
    for (const line of ["1", "2", "3", "4"]) batcher.add("a", line);
    batcher.add("b", "autre");
    batcher.add("a", "5");
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("1\n2\n3\n4\n5", "general");
    expect(batcher.pending()).toEqual(new Map([["b", 1]]));
  });

  it("add_differentKeys_neverMixedInOneMessage", async () => {
    batcher.add("a", "une");
    batcher.add("b", "autre");
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send.mock.calls.map(([message]) => message)).toEqual(["une", "autre"]);
  });

  it("add_blankLine_ignored", () => {
    batcher.add("k", "   ");
    expect(batcher.pending().size).toBe(0);
  });

  it("add_timer_unrefedSoItNeverHoldsTheProcess", () => {
    jest.useRealTimers();
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>;
    jest.spyOn(globalThis, "setTimeout").mockReturnValue(timer);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);
    batcher.add("k", "ligne");
    expect(unref).toHaveBeenCalled();
  });

  it("add_batchOverCharLimit_splitIntoOrderedMessages", async () => {
    const small = createBotLogBatcher({ send, maxChars: 10 });
    for (const line of ["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"]) small.add("k", line);
    await settle();
    expect(send.mock.calls.map(([message]) => message)).toEqual(["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"]);
  });

  it("add_sendRejects_errorSwallowedAndNextBatchStillSent", async () => {
    send.mockRejectedValueOnce(new Error("bot"));
    batcher.add("a", "perdue");
    await batcher.flush("a");
    batcher.add("b", "suivante");
    await batcher.flush("b");
    expect(send).toHaveBeenLastCalledWith("suivante", "general");
  });

  it("add_renderedLine_sentVerbatimWithNothingAdded", async () => {
    batcher.add("k", "🛠️ Arbitre désigné par le staff");
    await batcher.flush("k");
    expect(send).toHaveBeenCalledWith("🛠️ Arbitre désigné par le staff", "general");
  });
});

describe("flush", () => {
  it("flush_key_sendsOnlyThatBatchAtOnce", async () => {
    batcher.add("a", "une");
    batcher.add("b", "autre");
    await batcher.flush("a");
    expect(send).toHaveBeenCalledTimes(1);
    expect(batcher.pending()).toEqual(new Map([["b", 1]]));
  });

  it("flush_unknownKey_sendsNothing", async () => {
    await batcher.flush("absente");
    expect(send).not.toHaveBeenCalled();
  });

  it("flush_beforeTheWindow_timerDoesNotSendAgain", async () => {
    batcher.add("k", "une");
    await batcher.flush("k");
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("flushAll", () => {
  it("flushAll_pendingBatches_allSentBeforeResolving", async () => {
    batcher.add("a", "une");
    batcher.add("b", "deux");
    await batcher.flushAll();
    expect(send.mock.calls.map(([message]) => message)).toEqual(["une", "deux"]);
    expect(batcher.pending().size).toBe(0);
  });

  it("flushAll_nothingPending_resolvesWithoutSending", async () => {
    await batcher.flushAll();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("reset", () => {
  it("reset_pendingBatches_droppedWithoutSending", async () => {
    batcher.add("k", "une");
    batcher.reset();
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * Âge maximal (`BOT_LOG_BATCH_MAX_AGE_MS`) : un lot part au plus tard 10 min
 * après sa première ligne, même si chaque ligne relance le silence.
 */
const MAX_AGE = 10 * 60 * 1000;
const FOUR_MIN = 4 * 60 * 1000;

describe("maxAge", () => {
  it("maxAge_lineEveryFourMinutes_sentTenMinutesAfterTheFirst", async () => {
    batcher.add("k", "un");
    jest.advanceTimersByTime(FOUR_MIN);
    batcher.add("k", "deux");
    jest.advanceTimersByTime(FOUR_MIN);
    batcher.add("k", "trois");
    jest.advanceTimersByTime(MAX_AGE - 2 * FOUR_MIN - 1);
    await settle();
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("un\ndeux\ntrois", "general");
    expect(batcher.pending().size).toBe(0);
  });

  it("maxAge_flushedByAge_nextLineStartsAFreshAgeAndWindow", async () => {
    batcher.add("k", "un");
    jest.advanceTimersByTime(FOUR_MIN);
    batcher.add("k", "deux");
    jest.advanceTimersByTime(MAX_AGE - FOUR_MIN);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    batcher.add("k", "trois");
    jest.advanceTimersByTime(FOUR_MIN);
    batcher.add("k", "quatre");
    jest.advanceTimersByTime(FOUR_MIN);
    batcher.add("k", "cinq");
    jest.advanceTimersByTime(MAX_AGE - 2 * FOUR_MIN - 1);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(send).toHaveBeenLastCalledWith("trois\nquatre\ncinq", "general");
  });

  it("maxAge_quietWindowBeforeTheAge_stillFlushesAtFiveMinutes", async () => {
    batcher.add("k", "un");
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(MAX_AGE);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("maxAge_capOfFiveLines_stillImmediateAndStaleAgeDoesNotFireLater", async () => {
    batcher.add("k", "1");
    jest.advanceTimersByTime(FOUR_MIN);
    for (const line of ["2", "3", "4", "5"]) batcher.add("k", line);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    batcher.add("k", "6");
    jest.advanceTimersByTime(FOUR_MIN);
    batcher.add("k", "7");
    // t = 10,5 min : l'âge du premier lot (10 min) est échu, pas celui du suivant.
    jest.advanceTimersByTime(MAX_AGE - 2 * FOUR_MIN + FOUR_MIN / 2 + 1000);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(batcher.pending().get("k")).toBe(2);
  });

  it("maxAge_differentKeys_ageCountedPerKey", async () => {
    const TWO_MIN = 2 * 60 * 1000;
    batcher.add("a", "a1");
    jest.advanceTimersByTime(TWO_MIN);
    batcher.add("b", "b1");
    jest.advanceTimersByTime(TWO_MIN);
    batcher.add("a", "a2");
    jest.advanceTimersByTime(TWO_MIN);
    batcher.add("b", "b2");
    jest.advanceTimersByTime(TWO_MIN);
    batcher.add("a", "a3");
    jest.advanceTimersByTime(MAX_AGE - 4 * TWO_MIN);
    await settle();
    expect(send.mock.calls.map(([message]) => message)).toEqual(["a1\na2\na3"]);
    expect(batcher.pending().get("b")).toBe(2);
  });

  it("maxAge_flushAll_clearsBothTimers", async () => {
    batcher.add("k", "un");
    await batcher.flushAll();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(MAX_AGE);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("maxAge_reset_clearsBothTimers", () => {
    batcher.add("k", "un");
    expect(jest.getTimerCount()).toBe(2);
    batcher.reset();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("maxAge_customLimit_overridesTheDefault", async () => {
    const short = createBotLogBatcher({ send, maxAgeMs: 1000, windowMs: 5000 });
    short.add("k", "un");
    jest.advanceTimersByTime(1000);
    await settle();
    expect(send).toHaveBeenCalledWith("un", "general");
    short.reset();
  });

  it("maxAge_timer_unrefedSoItNeverHoldsTheProcess", () => {
    jest.useRealTimers();
    const unref = jest.fn();
    const timer = { unref } as unknown as ReturnType<typeof setTimeout>;
    jest.spyOn(globalThis, "setTimeout").mockReturnValue(timer);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);
    batcher.add("k", "ligne");
    expect(unref).toHaveBeenCalledTimes(2);
  });
});

describe("catégories", () => {
  it("category_sentWithTheBatch_andNeverMixedBetweenKeys", async () => {
    batcher.add("t:referees", "arbitre", "referees");
    batcher.add("t:casts", "cast", "casts");
    batcher.add("t:referees", "arbitre bis", "referees");
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls).toContainEqual(["arbitre\narbitre bis", "referees"]);
    expect(send.mock.calls).toContainEqual(["cast", "casts"]);
  });

  it("category_capPerKey_otherCategoryKeepsItsOwnCount", async () => {
    for (const line of ["1", "2", "3", "4"]) batcher.add("t:referees", line, "referees");
    batcher.add("t:casts", "c", "casts");
    batcher.add("t:referees", "5", "referees");
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("1\n2\n3\n4\n5", "referees");
    expect(batcher.pending().get("t:casts")).toBe(1);
  });

  it("category_maxAgePerKey_eachCategoryCountsItsOwnAge", async () => {
    const MIN = 60 * 1000;
    batcher.add("a", "un", "maps");
    jest.advanceTimersByTime(4 * MIN);
    batcher.add("a", "deux", "maps");
    jest.advanceTimersByTime(4 * MIN);
    batcher.add("a", "trois", "maps");
    batcher.add("b", "autre", "schedule");
    jest.advanceTimersByTime(2 * MIN);
    await settle();
    expect(send.mock.calls).toEqual([["un\ndeux\ntrois", "maps"]]);
    jest.advanceTimersByTime(3 * MIN);
    await settle();
    expect(send.mock.calls).toEqual([["un\ndeux\ntrois", "maps"], ["autre", "schedule"]]);
  });

  it("category_flushAll_sendsEachCategoryInItsOwnMessage", async () => {
    batcher.add("a", "x", "results");
    batcher.add("b", "y", "admin");
    await batcher.flushAll();
    expect(send.mock.calls).toEqual([["x", "results"], ["y", "admin"]]);
  });

  it("category_noneGiven_general", async () => {
    batcher.add("k", "ligne");
    await batcher.flush("k");
    expect(send).toHaveBeenCalledWith("ligne", "general");
  });

  it("header_option_opensEveryMessageAndCountsInTheLimit", async () => {
    const headed = createBotLogBatcher({ send, header: (category) => `# ${category}`, maxChars: 40 });
    headed.add("k", "a".repeat(20), "maps");
    headed.add("k", "b".repeat(20), "maps");
    await headed.flush("k");
    const messages = send.mock.calls.map(([message]) => message);
    expect(messages).toEqual([`# maps\n${"a".repeat(20)}`, `# maps\n${"b".repeat(20)}`]);
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(40);
    headed.reset();
  });

  it("dispatch_fullLengthDigest_sentAsSingleAlertMessage", async () => {
    const headed = createBotLogBatcher({ send, header: botLogHeader });
    const digest = "d".repeat(REFEREE_DIGEST_LOG_MAX_LENGTH);
    headed.add("k", digest, "referee-digest");
    await headed.flush("k");
    // Un programme complet, en-tête compris, part en une seule alerte.
    expect(send.mock.calls).toEqual([[`🔔 Matchs à arbitrer
${digest}`, "referee-digest"]]);
    headed.reset();
  });
});
