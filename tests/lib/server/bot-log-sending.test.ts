import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
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
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:3", 1]]));
  });

  it("sendBotLog_windowEnds_onePostToInternalLogWithTheJoinedLines", async () => {
    jest.useFakeTimers();
    await sendBotLog("un", { tournamentId: 3 });
    await sendBotLog("deux", { tournamentId: 3 });
    jest.advanceTimersByTime(WINDOW);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4400/internal/log");
    expect(postedMessages()).toEqual(["un\ndeux"]);
  });

  it("sendBotLog_twoTournaments_twoSeparatePosts", async () => {
    await sendBotLog("A", { tournamentId: 1 });
    await sendBotLog("B", { tournamentId: 2 });
    await sendBotLog("global");
    await flushAllBotLogBatches();
    expect(postedMessages()).toEqual(["A", "B", "global"]);
  });

  it("sendBotLog_botUnreachable_neverThrows", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendBotLog("ligne")).resolves.toBeUndefined();
    await expect(flushAllBotLogBatches()).resolves.toBeUndefined();
  });
});

describe("flushBotLogBatch", () => {
  it("flushBotLogBatch_tournament_postsThatBatchAtOnce", async () => {
    await sendBotLog("cartes", { tournamentId: 7 });
    await sendBotLog("ailleurs", { tournamentId: 8 });
    await flushBotLogBatch({ tournamentId: 7 });
    expect(postedMessages()).toEqual(["cartes"]);
    expect(pendingBotLogBatches()).toEqual(new Map([["log:tournament:8", 1]]));
  });
});
