import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/coalescer");

import { flushAllBotLogBatches } from "@/lib/server/bot-integration";
import { flushAllCoalescers } from "@/lib/server/coalescer";
import { flushBotLogsBeforeExit, holdExitUntil, installBotLogShutdownFlush } from "@/lib/server/bot-log-shutdown";
import { resetBotLogShutdownState } from "@/tests/helpers/bot-log-batches";

/** Arrêt propre : les lots du journal en attente partent (`docs/features/LOG_BATCHING.md`). */
let onceSpy: jest.SpiedFunction<typeof process.once>;
let handlers: Map<string, () => void>;

beforeEach(() => {
  jest.clearAllMocks();
  resetBotLogShutdownState();
  jest.mocked(flushAllBotLogBatches).mockResolvedValue();
  jest.mocked(flushAllCoalescers).mockResolvedValue();
  handlers = new Map();
  onceSpy = jest.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => {
    handlers.set(event, listener);
    return process;
  }) as typeof process.once);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("flushBotLogsBeforeExit", () => {
  it("flushBotLogsBeforeExit_pendingBatches_flushed", async () => {
    await flushBotLogsBeforeExit();
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });

  it("flushBotLogsBeforeExit_flushHangs_resolvesAtTheTimeout", async () => {
    jest.useFakeTimers();
    jest.mocked(flushAllBotLogBatches).mockReturnValue(new Promise<void>(() => undefined));
    const done = jest.fn();
    void flushBotLogsBeforeExit(500).then(done);
    await jest.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it("flushBotLogsBeforeExit_flushRejects_neverThrows", async () => {
    jest.mocked(flushAllBotLogBatches).mockRejectedValue(new Error("bot"));
    await expect(flushBotLogsBeforeExit()).resolves.toBeUndefined();
  });
});

describe("flushBotLogsBeforeExit — rafales regroupées", () => {
  it("flushBotLogsBeforeExit_pendingBurst_coalescersBeforeBatches", async () => {
    const order: string[] = [];
    jest.mocked(flushAllCoalescers).mockImplementation(async () => {
      order.push("coalescers");
    });
    jest.mocked(flushAllBotLogBatches).mockImplementation(async () => {
      order.push("batches");
    });
    await flushBotLogsBeforeExit();
    expect(order).toEqual(["coalescers", "batches"]);
  });

  it("flushBotLogsBeforeExit_coalescerHangs_batchesStillFlushedAtHalfTheTimeout", async () => {
    jest.useFakeTimers();
    jest.mocked(flushAllCoalescers).mockReturnValue(new Promise<void>(() => undefined));
    void flushBotLogsBeforeExit(1_000);
    await jest.advanceTimersByTimeAsync(499);
    expect(flushAllBotLogBatches).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });

  it("flushBotLogsBeforeExit_coalescerFlushRejects_batchesStillFlushed", async () => {
    jest.mocked(flushAllCoalescers).mockRejectedValue(new Error("boom"));
    await expect(flushBotLogsBeforeExit()).resolves.toBeUndefined();
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });
});

describe("holdExitUntil", () => {
  it("holdExitUntil_exitCalledDuringTheFlush_deferredUntilItEnds", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    holdExitUntil(done);
    process.exit(0);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    finish();
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("holdExitUntil_failureCodeDuringTheFlush_exitsAtOnce", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    holdExitUntil(new Promise<void>(() => undefined));
    process.exit(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("holdExitUntil_successRequestedTwice_replayedOnce", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    holdExitUntil(Promise.resolve());
    process.exit(0);
    process.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("holdExitUntil_noExitDuringTheFlush_exitRestoredUntouched", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    holdExitUntil(Promise.resolve());
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.exit).toBe(exit);
    expect(exit).not.toHaveBeenCalled();
  });
  it("holdExitUntil_failureAfterHeldSuccess_exitsWithTheFailureCode", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    holdExitUntil(Promise.resolve());
    process.exit(0);
    process.exit(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("holdExitUntil_successAfterHeldFailure_keepsTheFailureCode", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    holdExitUntil(Promise.resolve());
    process.exit(1);
    process.exit(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("holdExitUntil_noCodeThenFailure_exitsWithTheFailureCode", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    holdExitUntil(Promise.resolve());
    process.exit();
    process.exit(2);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(2);
  });
  it("holdExitUntil_noCodeWithFailingExitCodeAfterHeldSuccess_exitsWithTheExitCode", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    const previousExitCode = process.exitCode;
    holdExitUntil(Promise.resolve());
    process.exit(0);
    process.exitCode = 3;
    process.exit();
    process.exitCode = previousExitCode;
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(3);
  });
});

describe("installBotLogShutdownFlush", () => {
  it("installBotLogShutdownFlush_calledTwice_listensOncePerSignal", () => {
    installBotLogShutdownFlush();
    installBotLogShutdownFlush();
    expect(onceSpy.mock.calls.map(([event]) => event)).toEqual(["SIGTERM", "SIGINT"]);
  });

  it("installBotLogShutdownFlush_signalWithNextListening_flushesWithoutExiting", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    jest.spyOn(process, "listenerCount").mockReturnValue(1);
    installBotLogShutdownFlush();
    handlers.get("SIGTERM")?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushAllBotLogBatches).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("installBotLogShutdownFlush_signalWithNoOtherListener_signalRaisedAgainAfterTheFlush", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    const kill = jest.spyOn(process, "kill").mockImplementation(() => true);
    jest.spyOn(process, "listenerCount").mockReturnValue(0);
    installBotLogShutdownFlush();
    handlers.get("SIGINT")?.();
    await new Promise((resolve) => setImmediate(resolve));
    // Relancé sans écouteur, le signal termine en 128 + n, jamais en succès.
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGINT");
    expect(exit).not.toHaveBeenCalled();
  });

  it("installBotLogShutdownFlush_twoSignals_oneFlushShared", async () => {
    jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    jest.spyOn(process, "listenerCount").mockReturnValue(1);
    installBotLogShutdownFlush();
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });

  it("installBotLogShutdownFlush_alreadyInstalledByAnotherModuleCopy_listensNoMore", () => {
    (globalThis as typeof globalThis & { __bgBotLogShutdown?: unknown }).__bgBotLogShutdown = {
      installed: true,
      flush: null,
    };
    installBotLogShutdownFlush();
    expect(onceSpy).not.toHaveBeenCalled();
  });
});

describe("flushBotLogsBeforeExit — tour des passages", () => {
  const order = globalThis as typeof globalThis & { __bgBotLogOrder?: Promise<void> };

  afterEach(() => {
    delete order.__bgBotLogOrder;
  });

  it("flushBotLogsBeforeExit_orderTurnPending_awaitedBeforeTheBatchesLeave", async () => {
    let release: () => void = () => undefined;
    order.__bgBotLogOrder = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = flushBotLogsBeforeExit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushAllBotLogBatches).not.toHaveBeenCalled();
    release();
    await done;
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });

  it("flushBotLogsBeforeExit_orderTurnHangs_boundedByHalfTheTimeout", async () => {
    jest.useFakeTimers();
    order.__bgBotLogOrder = new Promise<void>(() => undefined);
    void flushBotLogsBeforeExit(1_000);
    await jest.advanceTimersByTimeAsync(499);
    expect(flushAllBotLogBatches).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });

  it("flushBotLogsBeforeExit_orderTurnRejects_neverThrowsAndStillFlushes", async () => {
    order.__bgBotLogOrder = Promise.reject(new Error("tour"));
    await expect(flushBotLogsBeforeExit()).resolves.toBeUndefined();
    expect(flushAllBotLogBatches).toHaveBeenCalledTimes(1);
  });
});
