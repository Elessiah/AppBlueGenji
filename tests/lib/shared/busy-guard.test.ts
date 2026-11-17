import { describe, expect, it, jest } from "@jest/globals";
import { runExclusive, type BusyFlag } from "@/lib/shared/busy-guard";

/** Une promesse réglée à la main : la tâche reste « en vol » tant qu'on veut. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runExclusive", () => {
  it("runExclusive_idle_runsTaskAndReturnsValue", async () => {
    const flag: BusyFlag = { current: false };
    const setBusy = jest.fn<(busy: boolean) => void>();

    const actual = await runExclusive(flag, setBusy, async () => 42);

    expect(actual).toBe(42);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(flag.current).toBe(false);
  });

  it("runExclusive_taskStarts_flagAlreadyRaisedAndBusyShown", async () => {
    const flag: BusyFlag = { current: false };
    const setBusy = jest.fn<(busy: boolean) => void>();
    const seen: { flag: boolean | null; busyCalls: unknown[][] } = { flag: null, busyCalls: [] };

    await runExclusive(flag, setBusy, async () => {
      seen.flag = flag.current;
      seen.busyCalls = [...setBusy.mock.calls];
    });

    expect(seen.flag).toBe(true);
    expect(seen.busyCalls).toEqual([[true]]);
  });

  it("runExclusive_secondCallWhileInFlight_skippedReturnsUndefined", async () => {
    const flag: BusyFlag = { current: false };
    const setBusy = jest.fn<(busy: boolean) => void>();
    const first = deferred<string>();
    const second = jest.fn(async () => "second");

    const running = runExclusive(flag, setBusy, () => first.promise);
    const skipped = await runExclusive(flag, setBusy, second);
    first.resolve("first");

    expect(skipped).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
    expect(await running).toBe("first");
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("runExclusive_taskThrows_releasesFlagAndRethrows", async () => {
    const flag: BusyFlag = { current: false };
    const setBusy = jest.fn<(busy: boolean) => void>();

    await expect(
      runExclusive(flag, setBusy, async () => {
        throw new Error("NETWORK");
      }),
    ).rejects.toThrow("NETWORK");

    expect(flag.current).toBe(false);
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it("runExclusive_afterCompletion_nextCallRuns", async () => {
    const flag: BusyFlag = { current: false };
    const setBusy = jest.fn<(busy: boolean) => void>();
    await runExclusive(flag, setBusy, async () => "first");

    const actual = await runExclusive(flag, setBusy, async () => "second");

    expect(actual).toBe("second");
  });

  it("runExclusive_afterFailure_nextCallRuns", async () => {
    const flag: BusyFlag = { current: false };
    const setBusy = jest.fn<(busy: boolean) => void>();
    await runExclusive(flag, setBusy, async () => {
      throw new Error("REFUSED");
    }).catch(() => undefined);

    const actual = await runExclusive(flag, setBusy, async () => "retried");

    expect(actual).toBe("retried");
  });
});
