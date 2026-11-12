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
  proposalRetryDelayMs,
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
const failure = (status: number, headers: Record<string, string> = {}) =>
  ({ ok: false, status, headers: new Headers(headers), json: async () => ({}) }) as Response;

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
    fetchMock.mockResolvedValue(failure(500));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

    expect(PROPOSAL_REFRESH_ATTEMPTS).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Revue perf #542 : `proposals: null` est une réponse (rien de lisible pour
  // ce lecteur sur l'état relu), et un 4xx hors 429 un refus définitif (session
  // expirée, tournoi masqué) — ni l'un ni l'autre n'est retenté.
  it.each<[string, () => Response]>([
    ["useProposalMaps_serverAnswersNull_stopsRetrying", () => okResponse({ proposals: null })],
    ["useProposalMaps_definitiveRefusal404_stopsRetrying", () => failure(404)],
    ["useProposalMaps_unauthorized401_stopsRetrying", () => failure(401)],
  ])("%s", async (_name, response) => {
    fetchMock.mockResolvedValue(response());

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useProposalMaps_rateLimited429_keepsRetrying", async () => {
    fetchMock.mockResolvedValue(failure(429));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Revue perf #542 : la tentative suivante attend la réponse de la précédente,
  // et le `Retry-After` d'un 429 quand il dépasse l'espacement de base.
  it("useProposalMaps_slowRead_neverOverlapsAttempts", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useProposalMaps_rateLimited429WithRetryAfter_waitsServerDelay", async () => {
    fetchMock.mockResolvedValue(failure(429, { "Retry-After": "30" }));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(29_999);
    const callsBeforeRetryAfter = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1);

    expect(callsBeforeRetryAfter).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("useProposalMaps_unparsableAnswer_keepsRetrying", async () => {
    fetchMock.mockResolvedValue(okResponse({ proposals: { matchId: "x" } }));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

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

  // Revue perf #542 : une réponse lue clôt les tentatives, même plus récente
  // que l'instantané (la fusion l'écarte) — sa diffusion relancera la lecture.
  it("useProposalMaps_newerProposalThanSnapshot_stopsRetrying", async () => {
    const later = "2026-11-03T18:05:00.000Z";
    fetchMock.mockResolvedValue(okResponse({ proposals: { matchId: 70, team1: { reportedAt: later, maps: [map] }, team2: null } }));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));
    const result = render(match, NO_PROPOSALS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.match.team1Report?.maps).toEqual([]);
  });

  it("useProposalMaps_answerForAnotherMatch_isIgnored", async () => {
    fetchMock.mockResolvedValue(okResponse({ proposals: { matchId: 71, team1: { reportedAt: at, maps: [map] }, team2: null } }));

    render(match, NO_PROPOSALS);
    await settle();
    const result = render(match, NO_PROPOSALS);

    expect(result.match.team1Report?.maps).toEqual([]);
  });
});

/*
 * Revue #542 : les relectures épuisées sans détail (429, réseau, refus)
 * ne levaient pas l'attente, et les dialogues gardaient leurs boutons figés sur
 * « détail en attente » jusqu'au prochain report.
 */
describe("useProposalMaps — detailPending", () => {
  it("useProposalMaps_readInFlight_detailPending", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    expect(render(match, NO_PROPOSALS).detailPending).toBe(true);
  });

  it("useProposalMaps_attemptsExhausted_detailPendingLifted", async () => {
    fetchMock.mockResolvedValue(failure(500));

    render(match, NO_PROPOSALS);
    await jest.advanceTimersByTimeAsync(PROPOSAL_REFRESH_DELAY_MS * (PROPOSAL_REFRESH_ATTEMPTS + 2));

    expect(render(match, NO_PROPOSALS).detailPending).toBe(false);
  });

  it("useProposalMaps_definitiveRefusal_detailPendingLifted", async () => {
    fetchMock.mockResolvedValue(failure(404));

    render(match, NO_PROPOSALS);
    await settle();

    expect(render(match, NO_PROPOSALS).detailPending).toBe(false);
  });

  it("useProposalMaps_newReportAfterGivingUp_detailPendingAgain", async () => {
    fetchMock.mockResolvedValue(failure(404));
    render(match, NO_PROPOSALS);
    await settle();
    const newer = bracketMatch({
      ...match,
      team1Report: { team1Score: 2, team2Score: 0, reportedAt: "2026-11-03T18:05:00.000Z", maps: [] },
    });

    const result = render(newer, NO_PROPOSALS);

    expect(result.detailPending).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Revue standard #592 : le droit de lecture rendu après des tentatives
  // closes relance les lectures, même `reportsKey` — l'attente doit rouvrir,
  // sans quoi l'arbitrage tranchait « sans détail » pendant la lecture.
  it("useProposalMaps_readRightRegainedAfterSettled_detailPendingWhileRefetching", async () => {
    fetchMock.mockResolvedValueOnce(failure(404));
    render(match, NO_PROPOSALS);
    await settle();
    render(match, NO_PROPOSALS, false);
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    const result = render(match, NO_PROPOSALS, true);

    expect(result.detailPending).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("useProposalMaps_cannotRead_neverPending", () => {
    expect(render(match, NO_PROPOSALS, false).detailPending).toBe(false);
  });
});

describe("proposalRetryDelayMs", () => {
  it("proposalRetryDelayMs_noHeader_returnsBaseDelay", () => {
    expect(proposalRetryDelayMs(null)).toBe(4000);
  });

  it("proposalRetryDelayMs_shortRetryAfter_returnsBaseDelay", () => {
    expect(proposalRetryDelayMs("2")).toBe(4000);
  });

  it("proposalRetryDelayMs_longRetryAfter_returnsRetryAfterMs", () => {
    expect(proposalRetryDelayMs("30")).toBe(30_000);
  });

  it("proposalRetryDelayMs_unparsableHeader_returnsBaseDelay", () => {
    expect(proposalRetryDelayMs("soon")).toBe(4000);
  });
});
