import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/bot-integration");

import { flushAllBotLogBatches } from "@/lib/server/bot-integration";
import {
  flushBotLogsBeforeExit,
  holdExitUntil,
  installBotLogShutdownFlush,
  resetBotLogShutdownState,
} from "@/lib/server/bot-log-shutdown";

/** Arrêt propre : les lots du journal en attente partent (`docs/features/LOG_BATCHING.md`). */
let onceSpy: jest.SpiedFunction<typeof process.once>;
let handlers: Map<string, () => void>;

beforeEach(() => {
  jest.clearAllMocks();
  resetBotLogShutdownState();
  jest.mocked(flushAllBotLogBatches).mockResolvedValue();
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

  it("installBotLogShutdownFlush_signalWithNoOtherListener_exitsAfterTheFlush", async () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    jest.spyOn(process, "listenerCount").mockReturnValue(0);
    installBotLogShutdownFlush();
    handlers.get("SIGINT")?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledWith(0);
  });
});
