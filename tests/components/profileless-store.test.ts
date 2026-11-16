import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({ usePathname: () => "/" }));

import {
  createProfilelessStore,
  PROFILELESS_REFRESH_MS,
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
let fetchIds: jest.Mock<FetchIds>;

function store(options: { seed?: readonly number[]; lookup?: boolean } = {}): ProfilelessStore {
  return createProfilelessStore({
    seed: options.seed,
    lookup: options.lookup ?? true,
    fetchIds,
    now: () => clock,
    schedule: (run) => {
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
});
