import { describe, expect, it, jest } from "@jest/globals";
import { cropThenUpload, runExclusive, type BusyFlag } from "@/lib/shared/busy-guard";

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

describe("cropThenUpload — recadrage puis envoi sous la garde", () => {
  function guard() {
    const flag: BusyFlag = { current: false };
    const run = <T,>(task: () => Promise<T>) => runExclusive(flag, () => undefined, task);
    return { flag, run };
  }

  it("cropThenUpload_cropped_uploadsImageAndReturnsTrue", async () => {
    const { run } = guard();
    const upload = jest.fn<(image: string) => Promise<void>>().mockResolvedValue(undefined);

    const started = await cropThenUpload({ run, crop: async () => "image", upload, setUploading: () => undefined });

    expect(started).toBe(true);
    expect(upload).toHaveBeenCalledWith("image");
  });

  it("cropThenUpload_cropCancelled_skipsUploadAndReleasesGuard", async () => {
    const { flag, run } = guard();
    const upload = jest.fn<(image: string) => Promise<void>>();

    const started = await cropThenUpload<string>({ run, crop: async () => null, upload, setUploading: () => undefined });

    expect(started).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(flag.current).toBe(false);
  });

  it("cropThenUpload_duringCrop_guardHeldSoSaveRefused", async () => {
    // « Ajouter » pressé pendant le recadrage partait sans la photo.
    const { run } = guard();
    const crop = deferred<string | null>();
    const save = jest.fn<() => Promise<string>>().mockResolvedValue("saved");
    const flow = cropThenUpload({ run, crop: () => crop.promise, upload: async () => undefined, setUploading: () => undefined });

    const saved = await run(save);

    expect(saved).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    crop.resolve(null);
    await flow;
  });

  it("cropThenUpload_otherSendInFlight_returnsFalseWithoutOpeningCrop", async () => {
    const { flag, run } = guard();
    flag.current = true;
    const crop = jest.fn<() => Promise<string | null>>();

    const started = await cropThenUpload({ run, crop, upload: async () => undefined, setUploading: () => undefined });

    expect(started).toBe(false);
    expect(crop).not.toHaveBeenCalled();
  });

  it("cropThenUpload_uploadThrows_releasesGuardAndUploadingFlag", async () => {
    const { flag, run } = guard();
    const setUploading = jest.fn<(uploading: boolean) => void>();

    await expect(
      cropThenUpload({ run, crop: async () => "image", upload: () => Promise.reject(new Error("réseau")), setUploading }),
    ).rejects.toThrow("réseau");

    expect(flag.current).toBe(false);
    expect(setUploading).toHaveBeenLastCalledWith(false);
  });

  it("cropThenUpload_uploading_setBeforeCropAndClearedAfterUpload", async () => {
    const { run } = guard();
    const calls: string[] = [];

    await cropThenUpload({
      run,
      crop: async () => {
        calls.push("crop");
        return "image";
      },
      upload: async () => {
        calls.push("upload");
      },
      setUploading: (uploading) => calls.push(`uploading:${uploading}`),
    });

    expect(calls).toEqual(["uploading:true", "crop", "upload", "uploading:false"]);
  });
});
