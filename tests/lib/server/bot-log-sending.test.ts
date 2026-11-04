import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BOT_LOG_CATEGORIES } from "@/lib/shared/bot-log-category";
import { flushAllBotLogBatches, flushBotLogBatch, sendBotLog } from "@/lib/server/bot-integration";
import { pendingBotLogBatches, resetBotLogBatches } from "@/tests/helpers/bot-log-batches";

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
    sendBotLog("ligne", { tournamentId: 3 });
    jest.advanceTimersByTime(WINDOW - 1);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:3:general", 1]]));
  });

  it("sendBotLog_windowEnds_onePostToInternalLogWithTheJoinedLines", async () => {
    jest.useFakeTimers();
    sendBotLog("un", { tournamentId: 3 });
    sendBotLog("deux", { tournamentId: 3 });
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4400/internal/log");
    expect(postedMessages()).toEqual(["📋 Journal\nun\ndeux"]);
  });

  it("sendBotLog_twoTournaments_twoSeparatePosts", async () => {
    sendBotLog("A", { tournamentId: 1 });
    sendBotLog("B", { tournamentId: 2 });
    sendBotLog("global");
    await flushAllBotLogBatches();
    expect(postedMessages()).toEqual(["📋 Journal\nA", "📋 Journal\nB", "📋 Journal\nglobal"]);
  });

  it("sendBotLog_botUnreachable_neverThrows", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(() => sendBotLog("ligne")).not.toThrow();
    await expect(flushAllBotLogBatches()).resolves.toBeUndefined();
  });
});

describe("kind et catégories", () => {
  it("sendBotLog_noCategory_postsKindLogWithTheGeneralHeader", async () => {
    sendBotLog("ligne", { tournamentId: 3 });
    await flushAllBotLogBatches();
    expect(postedBodies()).toEqual([{ message: "📋 Journal\nligne", kind: "log" }]);
  });

  it("sendBotLog_refereeDigest_postsKindAlert", async () => {
    sendBotLog("relevé", { category: "referee-digest" });
    await flushAllBotLogBatches();
    expect(postedBodies()).toEqual([{ message: "🔔 Matchs à arbitrer\nrelevé", kind: "alert" }]);
  });

  it("sendBotLog_refereeSelfAction_postsKindAlert", async () => {
    sendBotLog("arbitre qui joue", { category: "referee-self-action" });
    await flushAllBotLogBatches();
    expect(postedBodies()).toEqual([{ message: "⚠️ Arbitrage à vérifier\narbitre qui joue", kind: "alert" }]);
  });

  it("sendBotLog_alertCategory_postedWithoutWaitingForTheWindow", async () => {
    jest.useFakeTimers();
    sendBotLog("arbitre qui joue", { tournamentId: 3, category: "referee-self-action" });
    await settle();
    expect(postedBodies()).toEqual([{ message: "⚠️ Arbitrage à vérifier\narbitre qui joue", kind: "alert" }]);
    expect(pendingBotLogBatches().size).toBe(0);
  });

  it("sendBotLog_alertCategory_pendingLinesOfItsTournamentSentFirst", async () => {
    jest.useFakeTimers();
    sendBotLog("désignation", { tournamentId: 3, category: "referees" });
    sendBotLog("autre tournoi", { tournamentId: 4, category: "referees" });
    sendBotLog("arbitre qui joue", { tournamentId: 3, category: "referee-self-action" });
    await settle();
    expect(postedMessages()).toEqual(["🧑‍⚖️ Arbitrage\ndésignation", "⚠️ Arbitrage à vérifier\narbitre qui joue"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:4:referees", 1]]));
  });

  it("sendBotLog_alertWithoutTournament_globalLotsNotFlushed", async () => {
    jest.useFakeTimers();
    sendBotLog("inscription", { category: "signups" });
    sendBotLog("relevé", { category: "referee-digest" });
    await settle();
    expect(postedMessages()).toEqual(["🔔 Matchs à arbitrer\nrelevé"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:global:signups", 1]]));
  });

  it("sendBotLog_scopeGetterThrows_neverThrows", () => {
    const hostile = {
      get tournamentId(): number {
        throw new Error("scope");
      },
    };
    expect(() => sendBotLog("ligne", hostile)).not.toThrow();
  });

  it("sendBotLog_burstOfAlertsSameTournament_oneMessage", async () => {
    jest.useFakeTimers();
    sendBotLog("un", { tournamentId: 3, category: "staff-removal" });
    sendBotLog("deux", { tournamentId: 3, category: "staff-removal" });
    sendBotLog("trois", { tournamentId: 3, category: "staff-removal" });
    await settle();
    expect(postedMessages()).toHaveLength(1);
    expect(postedMessages()[0]).toContain("un"+String.fromCharCode(10)+"deux"+String.fromCharCode(10)+"trois");
  });

  it("sendBotLog_alertsOfTwoTournaments_oneMessageEach", async () => {
    jest.useFakeTimers();
    sendBotLog("A", { tournamentId: 3, category: "staff-removal" });
    sendBotLog("B", { tournamentId: 4, category: "staff-removal" });
    await settle();
    expect(postedMessages()).toHaveLength(2);
  });

  it("sendBotLog_alertFromAnotherModuleCopy_burstStateSharedOnGlobalThis", async () => {
    jest.useFakeTimers();
    let otherCopy: typeof sendBotLog = sendBotLog;
    jest.isolateModules(() => {
      otherCopy = (require("@/lib/server/bot-integration") as { sendBotLog: typeof sendBotLog }).sendBotLog;
    });
    const shared = (globalThis as typeof globalThis & { __bgBotLogAlertFlushes?: Set<string> }).__bgBotLogAlertFlushes;
    otherCopy("deux", { tournamentId: 3, category: "staff-removal" });
    // La rafale est visible depuis la copie principale : un seul vidage sera posé.
    expect(shared?.has("tournament:3")).toBe(true);
    await settle();
    expect(postedMessages()).toHaveLength(1);
  });

  it("sendBotLog_logCategory_waitsForTheWindow", async () => {
    jest.useFakeTimers();
    sendBotLog("cartes", { tournamentId: 3, category: "maps" });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendBotLog_stringTournamentId_joinsThatTournamentsBatch", () => {
    sendBotLog("ligne", { tournamentId: "3" });
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:3:general", 1]]));
  });

  it("sendBotLog_transportReplacedOnGlobal_latestTransportUsed", async () => {
    const state = globalThis as typeof globalThis & {
      __bgBotLogTransport?: (message: string, category: string) => Promise<void>;
    };
    const original = state.__bgBotLogTransport;
    const transport = jest.fn(async (_message: string, _category: string) => undefined);
    state.__bgBotLogTransport = transport;
    try {
      sendBotLog("ligne", { tournamentId: 3 });
      await flushBotLogBatch({ tournamentId: 3 });
      expect(transport).toHaveBeenCalledWith("📋 Journal\nligne", "general");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      state.__bgBotLogTransport = original;
    }
  });

  it("sendBotLog_everyOtherCategory_postsKindLog", async () => {
    const alerts = ["referee-digest", "referee-self-action", "staff-removal"];
    for (const category of BOT_LOG_CATEGORIES.filter((name) => !alerts.includes(name))) {
      sendBotLog(category, { category });
    }
    await flushAllBotLogBatches();
    expect(postedBodies().map((body) => body.kind)).toEqual(Array(BOT_LOG_CATEGORIES.length - 3).fill("log"));
  });

  it("sendBotLog_sameTournamentTwoCategories_twoMessagesNeverMixed", async () => {
    sendBotLog("arbitre", { tournamentId: 3, category: "referees" });
    sendBotLog("cast", { tournamentId: 3, category: "casts" });
    sendBotLog("arbitre 2", { tournamentId: 3, category: "referees" });
    await flushAllBotLogBatches();
    expect(postedMessages()).toEqual(["🧑‍⚖️ Arbitrage\narbitre\narbitre 2", "🎙️ Casts\ncast"]);
  });

  it("sendBotLog_categoryCap_eachCategoryReachesFiveOnItsOwn", async () => {
    for (let i = 1; i <= 4; i += 1) sendBotLog(`r${i}`, { tournamentId: 3, category: "referees" });
    for (let i = 1; i <= 4; i += 1) sendBotLog(`c${i}`, { tournamentId: 3, category: "casts" });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    sendBotLog("r5", { tournamentId: 3, category: "referees" });
    await settle();
    expect(postedMessages()).toEqual(["🧑‍⚖️ Arbitrage\nr1\nr2\nr3\nr4\nr5"]);
  });

  it("sendBotLog_windowPerCategory_eachSentAfterItsOwnSilence", async () => {
    jest.useFakeTimers();
    sendBotLog("a", { tournamentId: 3, category: "maps" });
    jest.advanceTimersByTime(WINDOW - 1000);
    sendBotLog("b", { tournamentId: 3, category: "schedule" });
    jest.advanceTimersByTime(1000);
    await settle();
    expect(postedMessages()).toEqual(["🗺️ Cartes\na"]);
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(postedMessages()).toEqual(["🗺️ Cartes\na", "📅 Programme\nb"]);
  });

  it("sendBotLog_headerCountedInTheMessageLimit", async () => {
    sendBotLog("x".repeat(1850), { category: "admin" });
    sendBotLog("y".repeat(1850), { category: "admin" });
    await flushAllBotLogBatches();
    for (const message of postedMessages()) expect(message.length).toBeLessThanOrEqual(1900);
  });

  it("sendBotLog_shutdownFlush_sendsEveryCategoryWithItsKind", async () => {
    sendBotLog("a", { tournamentId: 3, category: "results" });
    sendBotLog("b", { category: "referee-digest" });
    await flushAllBotLogBatches();
    expect(postedBodies().map((body) => body.kind).sort()).toEqual(["alert", "log"]);
    expect(pendingBotLogBatches().size).toBe(0);
  });
});

describe("flushBotLogBatch par catégorie", () => {
  it("flushBotLogBatch_noCategory_flushesEveryCategoryOfTheTournamentInArrivalOrder", async () => {
    sendBotLog("a", { tournamentId: 7, category: "maps" });
    sendBotLog("b", { tournamentId: 7, category: "casts" });
    sendBotLog("c", { tournamentId: 8, category: "maps" });
    await flushBotLogBatch({ tournamentId: 7 });
    // L'ordre d'arrivée des premières lignes, pas celui de `BOT_LOG_CATEGORIES`.
    expect(postedMessages()).toEqual(["🗺️ Cartes\na", "🎙️ Casts\nb"]);
  });

  it("flushBotLogBatch_category_flushesOnlyThatBatch", async () => {
    sendBotLog("a", { tournamentId: 7, category: "maps" });
    sendBotLog("b", { tournamentId: 7, category: "casts" });
    await flushBotLogBatch({ tournamentId: 7, category: "maps" });
    expect(postedMessages()).toEqual(["🗺️ Cartes\na"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:7:casts", 1]]));
  });
});

describe("flushBotLogBatch", () => {
  it("flushBotLogBatch_tournament_postsThatBatchAtOnce", async () => {
    sendBotLog("cartes", { tournamentId: 7 });
    sendBotLog("ailleurs", { tournamentId: 8, category: "maps" });
    await flushBotLogBatch({ tournamentId: 7 });
    expect(postedMessages()).toEqual(["📋 Journal\ncartes"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:8:maps", 1]]));
  });
});
