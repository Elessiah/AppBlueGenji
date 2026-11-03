import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `useProposalMaps` (ERREUR.txt EF-15) : une proposition déposée après la
 * connexion au flux se relit par la route du **seul** match, au plus trois
 * fois. Sans DOM ni moteur de rendu dans ce dépôt, les crochets de React sont
 * rejoués par un banc minimal (`certification-prompt-hook.test.ts`).
 */

type Deps = readonly unknown[] | undefined;
type Cleanup = void | (() => void);
type EffectSlot = { deps: Deps; cleanup: Cleanup; pending?: () => Cleanup };

const bench = {
  states: [] as unknown[],
  memos: [] as { deps: Deps; value: unknown }[],
  effects: [] as EffectSlot[],
  index: { state: 0, memo: 0, effect: 0 },
  dirty: false,
};

function sameDeps(a: Deps, b: Deps): boolean {
  return a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

jest.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = bench.index.state++;
    if (!(slot in bench.states)) bench.states[slot] = initial;
    const set = (value: unknown) => {
      if (Object.is(value, bench.states[slot])) return;
      bench.states[slot] = value;
      bench.dirty = true;
    };
    return [bench.states[slot], set];
  },
  useMemo: (factory: () => unknown, deps: Deps) => {
    const slot = bench.index.memo++;
    const previous = bench.memos[slot];
    if (previous && sameDeps(previous.deps, deps)) return previous.value;
    const value = factory();
    bench.memos[slot] = { deps, value };
    return value;
  },
  useEffect: (effect: () => Cleanup, deps: Deps) => {
    const slot = bench.index.effect++;
    const previous = bench.effects[slot];
    if (previous && sameDeps(previous.deps, deps)) return;
    bench.effects[slot] = { deps, cleanup: previous?.cleanup, pending: effect };
  },
}));

import {
  PROPOSAL_REFRESH_ATTEMPTS,
  PROPOSAL_REFRESH_DELAY_MS,
  useProposalMaps,
} from "@/app/(secured)/tournois/[id]/_hooks/useProposalMaps";
import type { BracketMatch, MatchProposalMaps } from "@/lib/shared/types";
import { bracketMatch } from "../helpers/bracket-match";

// Appelé hors composant, par le banc : le nom neutre le dit aux règles des crochets.
const runHook = useProposalMaps;
type HookResult = ReturnType<typeof useProposalMaps>;

const at = "2026-11-03T18:00:00.000Z";
const map = { mapNumber: 1, replayCode: "ABC123", team1Score: 2, team2Score: 0 };
const match = bracketMatch({
  id: 70,
  tournamentId: 5,
  team1Id: 1,
  team2Id: 2,
  status: "AWAITING_CONFIRMATION",
  team1Report: { team1Score: 1, team2Score: 0, reportedAt: at, maps: [] },
});
const NO_PROPOSALS: MatchProposalMaps[] = [];

function render(liveMatch: BracketMatch, proposals: ReadonlyArray<MatchProposalMaps>, canRead = true): HookResult {
  let result: HookResult;
  let rounds = 0;
  do {
    bench.dirty = false;
    bench.index = { state: 0, memo: 0, effect: 0 };
    result = runHook(liveMatch, proposals, canRead);
    for (const slot of bench.effects) {
      if (!slot.pending) continue;
      if (typeof slot.cleanup === "function") slot.cleanup();
      slot.cleanup = slot.pending();
      slot.pending = undefined;
    }
    rounds += 1;
  } while (bench.dirty && rounds < 20);
  return result;
}

function unmount(): void {
  for (const slot of bench.effects) if (typeof slot.cleanup === "function") slot.cleanup();
}

const fetchMock = jest.fn<typeof fetch>();
const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

/** Laisse filer les promesses de la lecture (réponse, puis corps). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  bench.states = [];
  bench.memos = [];
  bench.effects = [];
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  unmount();
  jest.useRealTimers();
});

describe("useProposalMaps", () => {
  it("useProposalMaps_staleProposal_readsOnlyThatMatchAndMergesDetail", async () => {
    fetchMock.mockResolvedValue(okResponse({ proposals: { matchId: 70, team1: { reportedAt: at, maps: [map] }, team2: null } }));

    render(match, NO_PROPOSALS);
    await settle();
    const result = render(match, NO_PROPOSALS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tournaments/5/matches/70/proposals");
    expect(result.match.team1Report?.maps).toEqual([map]);
    expect(result.proposals).toEqual([{ matchId: 70, team1: { reportedAt: at, maps: [map] }, team2: null }]);
  });

  it("useProposalMaps_detailArrived_stopsRetrying", async () => {
    fetchMock.mockResolvedValue(okResponse({ proposals: { matchId: 70, team1: { reportedAt: at, maps: [map] }, team2: null } }));

    render(match, NO_PROPOSALS);
    await settle();
    render(match, NO_PROPOSALS);
    jest.advanceTimersByTime(PROPOSAL_REFRESH_DELAY_MS * PROPOSAL_REFRESH_ATTEMPTS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useProposalMaps_detailNeverArrives_triesThreeTimesAtMost", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    render(match, NO_PROPOSALS);
    jest.advanceTimersByTime(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

    expect(PROPOSAL_REFRESH_ATTEMPTS).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("useProposalMaps_networkError_keepsDisplayedMatch", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(match, NO_PROPOSALS);
    await settle();
    const result = render(match, NO_PROPOSALS);

    expect(result.match.team1Report?.maps).toEqual([]);
    expect(result.proposals).toBe(NO_PROPOSALS);
  });

  it("useProposalMaps_cannotRead_neverFetches", () => {
    render(match, NO_PROPOSALS, false);
    jest.advanceTimersByTime(PROPOSAL_REFRESH_DELAY_MS * PROPOSAL_REFRESH_ATTEMPTS);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("useProposalMaps_contextAlreadyHasDetail_neverFetches", () => {
    const proposals: MatchProposalMaps[] = [{ matchId: 70, team1: { reportedAt: at, maps: [map] }, team2: null }];

    const result = render(match, proposals);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.match.team1Report?.maps).toEqual([map]);
  });

  it("useProposalMaps_unmount_abortsAndStopsRetrying", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    render(match, NO_PROPOSALS);
    unmount();
    jest.advanceTimersByTime(PROPOSAL_REFRESH_DELAY_MS * PROPOSAL_REFRESH_ATTEMPTS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("useProposalMaps_answerForAnotherMatch_isIgnored", async () => {
    fetchMock.mockResolvedValue(okResponse({ proposals: { matchId: 71, team1: { reportedAt: at, maps: [map] }, team2: null } }));

    render(match, NO_PROPOSALS);
    await settle();
    const result = render(match, NO_PROPOSALS);

    expect(result.match.team1Report?.maps).toEqual([]);
  });
});
