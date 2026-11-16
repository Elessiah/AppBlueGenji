import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({ usePathname: () => "/" }));

import {
  createProfilelessStore,
  fetchProfilelessIds,
  PROFILELESS_BURST_GAP_MS,
  PROFILELESS_CHUNKS_PER_BURST,
  PROFILELESS_REFRESH_MS,
  PROFILELESS_RETRY_MAX_MS,
  PROFILELESS_RETRY_MS,
  type ProfilelessStore,
} from "@/components/profileless-players";

/**
 * D86 : les liens demandent eux-mêmes leurs comptes, regroupés par rendu,
 * redemandés à la navigation au plus une fois par fenêtre.
 */
type FetchIds = (ids: readonly number[]) => Promise<number[] | null>;

let clock = 0;
let scheduled: (() => void)[] = [];
let delays: number[] = [];
let fetchIds: jest.Mock<FetchIds>;

function store(options: { seed?: readonly number[]; lookup?: boolean } = {}): ProfilelessStore {
  return createProfilelessStore({
    seed: options.seed,
    lookup: options.lookup ?? true,
    fetchIds,
    now: () => clock,
    schedule: (run, ms) => {
      delays.push(ms);
      scheduled.push(run);
    },
  });
}

/** Lance le regroupement en attente puis laisse les réponses arriver. */
async function flush(): Promise<void> {
  const runs = scheduled;
  scheduled = [];
  for (const run of runs) run();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  clock = 1_000_000;
  scheduled = [];
  delays = [];
  fetchIds = jest.fn<FetchIds>(async () => []);
});

describe("createProfilelessStore", () => {
  it("watch_sameRenderIds_oneBatchedQuestion", async () => {
    const profileless = store();

    profileless.watch(3);
    profileless.watch(8);
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(1);
    expect(fetchIds).toHaveBeenCalledWith([3, 8]);
  });

  it("watch_profilelessAnswer_notifiesAndFlagsAccount", async () => {
    fetchIds.mockResolvedValue([8]);
    const profileless = store();
    const listener = jest.fn();
    profileless.subscribe(listener);

    profileless.watch(3);
    profileless.watch(8);
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(profileless.isProfileless(8)).toBe(true);
    expect(profileless.isProfileless(3)).toBe(false);
  });

  it("watch_answerWithoutProfileless_noListenerCall", async () => {
    const profileless = store();
    const listener = jest.fn();
    profileless.subscribe(listener);

    profileless.watch(3);
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("watch_over100Ids_splitIntoChunks", async () => {
    const profileless = store();

    for (let id = 1; id <= 150; id += 1) profileless.watch(id);
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(2);
    expect(fetchIds.mock.calls[0][0]).toHaveLength(100);
    expect(fetchIds.mock.calls[1][0]).toHaveLength(50);
  });

  it("watch_idAlreadyInFlight_noDuplicateQuestion", async () => {
    fetchIds.mockReturnValue(new Promise<number[] | null>(() => undefined));
    const profileless = store();
    profileless.watch(3);
    await flush();
    clock += PROFILELESS_REFRESH_MS;

    profileless.watch(3);
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(1);
  });

  it("refreshStale_withinWindow_noNewQuestion", async () => {
    const profileless = store();
    profileless.watch(3);
    await flush();
    clock += PROFILELESS_REFRESH_MS - 1;

    profileless.refreshStale();
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(1);
  });

  it("refreshStale_afterWindow_asksShownAccountsOnly", async () => {
    const profileless = store();
    profileless.watch(3);
    const release = profileless.watch(8);
    await flush();
    release();
    clock += PROFILELESS_REFRESH_MS;

    profileless.refreshStale();
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(2);
    expect(fetchIds).toHaveBeenLastCalledWith([3]);
  });

  it("refreshStale_afterFailure_waitsRetryDelay", async () => {
    fetchIds.mockResolvedValueOnce(null);
    const profileless = store();
    profileless.watch(3);
    await flush();

    clock += PROFILELESS_RETRY_MS - 1;
    profileless.refreshStale();
    await flush();
    expect(fetchIds).toHaveBeenCalledTimes(1);

    clock += 1;
    profileless.refreshStale();
    await flush();
    expect(fetchIds).toHaveBeenCalledTimes(2);
  });

  it("refreshStale_answerTurnsProfileless_flagsAccount", async () => {
    const profileless = store();
    profileless.watch(3);
    await flush();
    fetchIds.mockResolvedValue([3]);
    clock += PROFILELESS_REFRESH_MS;

    profileless.refreshStale();
    await flush();

    expect(profileless.isProfileless(3)).toBe(true);
  });

  it("watch_lookupOff_neverFetches", async () => {
    const profileless = store({ lookup: false });

    profileless.watch(3);
    await flush();

    expect(fetchIds).not.toHaveBeenCalled();
  });

  it("seed_seededAccount_profilelessWithoutQuestion", async () => {
    const profileless = store({ seed: [5] });

    profileless.watch(5);
    await flush();

    expect(profileless.isProfileless(5)).toBe(true);
    expect(profileless.isSeeded(5)).toBe(true);
    expect(profileless.isSeeded(6)).toBe(false);
    expect(fetchIds).not.toHaveBeenCalled();
  });

  it("watch_invalidIds_neverAsked", async () => {
    const profileless = store();

    for (const id of [0, -4, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) profileless.watch(id);
    profileless.watch(3);
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(1);
    expect(fetchIds).toHaveBeenCalledWith([3]);
  });

  it("settle_failure_retriesByItselfWhileShown", async () => {
    fetchIds.mockResolvedValueOnce(null);
    const profileless = store();
    profileless.watch(3);
    await flush();
    expect(delays).toContain(PROFILELESS_RETRY_MS);

    clock += PROFILELESS_RETRY_MS;
    await flush();
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(2);
  });

  it("settle_failure_noRetryOnceUnshown", async () => {
    fetchIds.mockResolvedValueOnce(null);
    const profileless = store();
    const release = profileless.watch(3);
    await flush();
    release();

    clock += PROFILELESS_RETRY_MS;
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(1);
  });

  it("settle_repeatedFailures_backoffDoublesUpToCap", async () => {
    fetchIds.mockResolvedValue(null);
    const profileless = store();
    profileless.watch(3);
    await flush();
    for (let i = 0; i < 6; i++) {
      clock += PROFILELESS_RETRY_MAX_MS;
      await flush();
      await flush();
    }

    expect(delays.filter((ms) => ms > 50).slice(0, 3)).toEqual([PROFILELESS_RETRY_MS, PROFILELESS_RETRY_MS * 2, PROFILELESS_RETRY_MS * 4]);
    expect(Math.max(...delays.filter((ms) => ms > 50))).toBe(PROFILELESS_RETRY_MAX_MS);
  });

  it("refreshStale_unshownStaleAccount_forgotten", async () => {
    fetchIds.mockResolvedValue([8]);
    const profileless = store();
    const release = profileless.watch(8);
    await flush();
    release();
    clock += PROFILELESS_REFRESH_MS;

    profileless.refreshStale();

    expect(profileless.isProfileless(8)).toBe(false);
  });
});

describe("createProfilelessStore : reprises et salves", () => {
  it("retry_idsWithDifferentBackoffs_eachRetriedWhenDue", async () => {
    // A échoue une fois (15 s), B a déjà échoué deux fois (30 s) : B n'est pas oublié.
    fetchIds.mockResolvedValue(null);
    const profileless = store();
    profileless.watch(2);
    await flush();
    clock += PROFILELESS_RETRY_MAX_MS;
    await flush();
    await flush();
    profileless.watch(1);
    await flush();
    const callsBefore = fetchIds.mock.calls.length;

    clock += PROFILELESS_RETRY_MS;
    await flush();
    await flush();
    const afterFirstDelay = fetchIds.mock.calls.slice(callsBefore).flat(2);
    expect(afterFirstDelay).toContain(1);
    expect(afterFirstDelay).not.toContain(2);

    clock += PROFILELESS_RETRY_MAX_MS;
    await flush();
    await flush();
    expect(fetchIds.mock.calls.slice(callsBefore).flat(2)).toContain(2);
  });

  it("retry_lastLinkRemoved_timerCancelled", async () => {
    fetchIds.mockResolvedValueOnce(null);
    const cancel = jest.fn();
    const profileless = createProfilelessStore({
      lookup: true,
      fetchIds,
      now: () => clock,
      schedule: (run, ms) => {
        delays.push(ms);
        scheduled.push(run);
        return cancel;
      },
    });
    const release = profileless.watch(3);
    await flush();
    expect(delays).toContain(PROFILELESS_RETRY_MS);

    release();

    expect(cancel).toHaveBeenCalled();
  });

  it("flush_manyChunks_sentInPacedBursts", async () => {
    const profileless = store();
    const total = PROFILELESS_CHUNKS_PER_BURST * 100 + 120;

    for (let id = 1; id <= total; id += 1) profileless.watch(id);
    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(PROFILELESS_CHUNKS_PER_BURST);
    expect(delays).toContain(PROFILELESS_BURST_GAP_MS);

    await flush();

    expect(fetchIds).toHaveBeenCalledTimes(PROFILELESS_CHUNKS_PER_BURST + 2);
  });

  it("flush_idUnshownBeforeItsBurst_notAsked", async () => {
    const profileless = store();
    const release = profileless.watch(5);
    release();

    await flush();

    expect(fetchIds).not.toHaveBeenCalled();
  });
});

describe("fetchProfilelessIds", () => {
  it("fetchProfilelessIds_request_carriesTimeoutSignal", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () => new Response(JSON.stringify({ ids: [3] })));

    const ids = await fetchProfilelessIds([3, 8], fetchImpl);

    expect(ids).toEqual([3]);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetchProfilelessIds_rejectedFetch_returnsNull", async () => {
    const fetchImpl = jest.fn<typeof fetch>(async () => {
      throw new Error("aborted");
    });

    expect(await fetchProfilelessIds([3], fetchImpl)).toBeNull();
  });
});
