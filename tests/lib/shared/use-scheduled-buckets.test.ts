import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `useScheduledBuckets` : l'horloge est recalée **pendant le rendu** quand les
 * paniers changent (plus d'effet `setNow`, donc plus de second rendu complet),
 * et le minuteur de bascule reste posé sur la prochaine frontière. Sans DOM :
 * les crochets de React sont rejoués par un banc minimal (états et effets par
 * rang ; `useMemo` recalculé quand ses dépendances changent).
 */

type Deps = readonly unknown[];
const bench = {
  states: [] as unknown[],
  effects: [] as { deps: Deps; cleanup?: void | (() => void) }[],
  memos: [] as { deps: Deps; value: unknown }[],
  index: { state: 0, effect: 0, memo: 0 },
  rerenders: 0,
};

const sameDeps = (a: Deps, b: Deps) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

jest.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = bench.index.state++;
    if (!(slot in bench.states)) bench.states[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    const set = (next: unknown) => {
      bench.states[slot] = next;
      bench.rerenders += 1;
    };
    return [bench.states[slot], set];
  },
  useEffect: (effect: () => void | (() => void), deps: Deps) => {
    const slot = bench.index.effect++;
    const previous = bench.effects[slot];
    if (previous && sameDeps(previous.deps, deps)) return;
    if (typeof previous?.cleanup === "function") previous.cleanup();
    bench.effects[slot] = { deps, cleanup: effect() };
  },
  useMemo: (create: () => unknown, deps: Deps) => {
    const slot = bench.index.memo++;
    const previous = bench.memos[slot];
    if (previous && sameDeps(previous.deps, deps)) return previous.value;
    const value = create();
    bench.memos[slot] = { deps, value };
    return value;
  },
}));

import { useScheduledBuckets } from "@/lib/shared/hooks/useScheduledBuckets";

/** Appelé hors composant, par le banc. */
const runHook = useScheduledBuckets;
import type { TournamentBuckets } from "@/lib/shared/types";
import { tournamentCard } from "../../helpers/tournament-card";

const OPEN = Date.parse("2026-06-01T18:00:00Z");

function upcomingBuckets(id = 1): TournamentBuckets {
  return {
    upcoming: [
      tournamentCard({
        id,
        state: "UPCOMING",
        registrationOpenAt: new Date(OPEN).toISOString(),
        registrationCloseAt: "2026-06-01T19:00:00.000Z",
        startAt: "2026-06-01T20:00:00.000Z",
      }),
    ],
    registration: [],
    running: [],
    finished: [],
  };
}

function render(buckets: TournamentBuckets): TournamentBuckets {
  bench.index = { state: 0, effect: 0, memo: 0 };
  return runHook(buckets);
}

function unmount() {
  for (const slot of bench.effects) if (typeof slot.cleanup === "function") slot.cleanup();
  bench.effects = [];
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(OPEN - 60_000);
  bench.states = [];
  bench.effects = [];
  bench.memos = [];
  bench.rerenders = 0;
});

afterEach(() => {
  unmount();
  jest.useRealTimers();
});

describe("useScheduledBuckets", () => {
  it("au montage, ne demande aucun rendu de plus (l'horloge naît avec l'état)", () => {
    render(upcomingBuckets());
    expect(bench.rerenders).toBe(0);
  });

  it("fait basculer un tournoi à la seconde dite, sans requête", () => {
    const buckets = upcomingBuckets();
    expect(render(buckets).registration).toHaveLength(0);

    jest.advanceTimersByTime(60_000);
    const rescheduled = render(buckets);

    expect(rescheduled.registration.map((card) => card.id)).toEqual([1]);
    expect(rescheduled.upcoming).toHaveLength(0);
  });

  it("recale l'horloge pendant le rendu quand les paniers changent, sans passer par un effet", () => {
    const first = upcomingBuckets(1);
    render(first);
    // La page a dormi : la réponse suivante est lue à l'heure du moment.
    jest.setSystemTime(OPEN + 1_000);
    const second = upcomingBuckets(2);

    const rescheduled = render(second);
    const rendersAfterChange = bench.rerenders;

    // Rendu immédiatement correct : déjà reclassé à l'heure du client…
    expect(rescheduled.registration.map((card) => card.id)).toEqual([2]);
    // …le recalage est un état ajusté en cours de rendu (une seule demande de
    // rendu, que React rejoue avant tout affichage), pas un effet de plus.
    expect(rendersAfterChange).toBe(1);
    expect(bench.effects).toHaveLength(1);
  });

  it("garde la même référence tant que ni les paniers ni l'heure ne changent", () => {
    const buckets = upcomingBuckets();
    const first = render(buckets);
    const second = render(buckets);
    expect(second).toBe(first);
    expect(bench.rerenders).toBe(0);
  });

  it("ne pose aucun minuteur quand plus rien ne doit basculer", () => {
    const finished: TournamentBuckets = { upcoming: [], registration: [], running: [], finished: [] };
    render(finished);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("démonté, abandonne son minuteur", () => {
    render(upcomingBuckets());
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
