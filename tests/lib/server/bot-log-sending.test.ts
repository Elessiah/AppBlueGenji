import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BOT_LOG_CATEGORIES } from "@/lib/shared/bot-log-category";
import {
  flushAllBotLogBatches,
  flushBotLogBatch,
  pendingBotLogBatches,
  resetBotLogBatches,
  sendBotLog,
} from "@/lib/server/bot-integration";

/**
 * `sendBotLog` regroupe au lieu d'envoyer (`docs/features/LOG_BATCHING.md`) :
 * rien ne part vers `/internal/log` avant la fin du silence, un lot par tournoi.
 */
const WINDOW = 5 * 60 * 1000;
const originalEnv = { ...process.env };

let fetchMock: jest.SpiedFunction<typeof fetch>;

function postedBodies(): { message: string; kind?: string }[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { message: string; kind?: string });
}

function postedMessages(): string[] {
  return fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { message: string }).message);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.BOT_INTERNAL_URL;
  delete process.env.BOT_INTERNAL_HOST;
  delete process.env.BOT_INTERNAL_PORT;
  resetBotLogBatches();
  fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 200 }));
});

afterEach(() => {
  resetBotLogBatches();
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("sendBotLog", () => {
  it("sendBotLog_oneLine_nothingPostedBeforeTheWindow", async () => {
    jest.useFakeTimers();
    await sendBotLog("ligne", { tournamentId: 3 });
    jest.advanceTimersByTime(WINDOW - 1);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:3:general", 1]]));
  });

  it("sendBotLog_windowEnds_onePostToInternalLogWithTheJoinedLines", async () => {
    jest.useFakeTimers();
    await sendBotLog("un", { tournamentId: 3 });
    await sendBotLog("deux", { tournamentId: 3 });
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4400/internal/log");
    expect(postedMessages()).toEqual(["📋 Journal\nun\ndeux"]);
  });

  it("sendBotLog_twoTournaments_twoSeparatePosts", async () => {
    await sendBotLog("A", { tournamentId: 1 });
    await sendBotLog("B", { tournamentId: 2 });
    await sendBotLog("global");
    await flushAllBotLogBatches();
    expect(postedMessages()).toEqual(["📋 Journal\nA", "📋 Journal\nB", "📋 Journal\nglobal"]);
  });

  it("sendBotLog_botUnreachable_neverThrows", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendBotLog("ligne")).resolves.toBeUndefined();
    await expect(flushAllBotLogBatches()).resolves.toBeUndefined();
  });
});

describe("kind et catégories", () => {
  it("sendBotLog_noCategory_postsKindLogWithTheGeneralHeader", async () => {
    await sendBotLog("ligne", { tournamentId: 3 });
    await flushAllBotLogBatches();
    expect(postedBodies()).toEqual([{ message: "📋 Journal\nligne", kind: "log" }]);
  });

  it("sendBotLog_refereeDigest_postsKindAlert", async () => {
    await sendBotLog("relevé", { category: "referee-digest" });
    await flushAllBotLogBatches();
    expect(postedBodies()).toEqual([{ message: "🔔 Matchs à arbitrer\nrelevé", kind: "alert" }]);
  });

  it("sendBotLog_refereeSelfAction_postsKindAlert", async () => {
    await sendBotLog("arbitre qui joue", { category: "referee-self-action" });
    await flushAllBotLogBatches();
    expect(postedBodies()).toEqual([{ message: "⚠️ Arbitrage à vérifier\narbitre qui joue", kind: "alert" }]);
  });

  it("sendBotLog_everyOtherCategory_postsKindLog", async () => {
    const alerts = ["referee-digest", "referee-self-action"];
    for (const category of BOT_LOG_CATEGORIES.filter((name) => !alerts.includes(name))) {
      await sendBotLog(category, { category });
    }
    await flushAllBotLogBatches();
    expect(postedBodies().map((body) => body.kind)).toEqual(Array(BOT_LOG_CATEGORIES.length - 2).fill("log"));
  });

  it("sendBotLog_sameTournamentTwoCategories_twoMessagesNeverMixed", async () => {
    await sendBotLog("arbitre", { tournamentId: 3, category: "referees" });
    await sendBotLog("cast", { tournamentId: 3, category: "casts" });
    await sendBotLog("arbitre 2", { tournamentId: 3, category: "referees" });
    await flushAllBotLogBatches();
    expect(postedMessages()).toEqual(["🧑‍⚖️ Arbitrage\narbitre\narbitre 2", "🎙️ Casts\ncast"]);
  });

  it("sendBotLog_categoryCap_eachCategoryReachesFiveOnItsOwn", async () => {
    for (let i = 1; i <= 4; i += 1) await sendBotLog(`r${i}`, { tournamentId: 3, category: "referees" });
    for (let i = 1; i <= 4; i += 1) await sendBotLog(`c${i}`, { tournamentId: 3, category: "casts" });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    await sendBotLog("r5", { tournamentId: 3, category: "referees" });
    await settle();
    expect(postedMessages()).toEqual(["🧑‍⚖️ Arbitrage\nr1\nr2\nr3\nr4\nr5"]);
  });

  it("sendBotLog_windowPerCategory_eachSentAfterItsOwnSilence", async () => {
    jest.useFakeTimers();
    await sendBotLog("a", { tournamentId: 3, category: "maps" });
    jest.advanceTimersByTime(WINDOW - 1000);
    await sendBotLog("b", { tournamentId: 3, category: "schedule" });
    jest.advanceTimersByTime(1000);
    await settle();
    expect(postedMessages()).toEqual(["🗺️ Cartes\na"]);
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(postedMessages()).toEqual(["🗺️ Cartes\na", "📅 Programme\nb"]);
  });

  it("sendBotLog_headerCountedInTheMessageLimit", async () => {
    await sendBotLog("x".repeat(1850), { category: "admin" });
    await sendBotLog("y".repeat(1850), { category: "admin" });
    await flushAllBotLogBatches();
    for (const message of postedMessages()) expect(message.length).toBeLessThanOrEqual(1900);
  });

  it("sendBotLog_shutdownFlush_sendsEveryCategoryWithItsKind", async () => {
    await sendBotLog("a", { tournamentId: 3, category: "results" });
    await sendBotLog("b", { category: "referee-digest" });
    await flushAllBotLogBatches();
    expect(postedBodies().map((body) => body.kind).sort()).toEqual(["alert", "log"]);
    expect(pendingBotLogBatches().size).toBe(0);
  });
});

describe("flushBotLogBatch par catégorie", () => {
  it("flushBotLogBatch_noCategory_flushesEveryCategoryOfTheTournament", async () => {
    await sendBotLog("a", { tournamentId: 7, category: "maps" });
    await sendBotLog("b", { tournamentId: 7, category: "casts" });
    await sendBotLog("c", { tournamentId: 8, category: "maps" });
    await flushBotLogBatch({ tournamentId: 7 });
    expect(postedMessages()).toEqual(["🎙️ Casts\nb", "🗺️ Cartes\na"]);
  });

  it("flushBotLogBatch_category_flushesOnlyThatBatch", async () => {
    await sendBotLog("a", { tournamentId: 7, category: "maps" });
    await sendBotLog("b", { tournamentId: 7, category: "casts" });
    await flushBotLogBatch({ tournamentId: 7, category: "maps" });
    expect(postedMessages()).toEqual(["🗺️ Cartes\na"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:7:casts", 1]]));
  });
});

describe("flushBotLogBatch", () => {
  it("flushBotLogBatch_tournament_postsThatBatchAtOnce", async () => {
    await sendBotLog("cartes", { tournamentId: 7 });
    await sendBotLog("ailleurs", { tournamentId: 8, category: "maps" });
    await flushBotLogBatch({ tournamentId: 7 });
    expect(postedMessages()).toEqual(["📋 Journal\ncartes"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:8:maps", 1]]));
  });
});
