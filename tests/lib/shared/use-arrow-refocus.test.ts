/**
 * Focus rendu après un déplacement (`lib/shared/hooks/useArrowRefocus.ts`) :
 * les crochets de React sont simulés (aucun DOM dans Jest) et `document`
 * remplacé par un faux qui rend les flèches par leur `data-arrow`.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

type Effect = () => void;
const hooks: { effect: Effect | null; requestRender: jest.Mock<(update: (n: number) => number) => void> } = {
  effect: null,
  requestRender: jest.fn<(update: (n: number) => number) => void>(),
};

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  const register = (effect: Effect) => {
    hooks.effect = effect;
  };
  return {
    ...actual,
    useEffect: register,
    useLayoutEffect: register,
    useCallback: <T>(fn: T) => fn,
    useState: () => [0, hooks.requestRender],
    useRef: (initial: unknown) => ({ current: initial }),
  };
});

import { useArrowRefocus } from "@/lib/shared/hooks/useArrowRefocus";

type FakeArrow = { dataset: { edge?: string }; focus: jest.Mock<() => void> };
const makeArrow = (edge = false): FakeArrow => ({ dataset: edge ? { edge: "true" } : {}, focus: jest.fn<() => void>() });

const body = { tag: "body" };
const fakeDocument: { body: unknown; activeElement: unknown; arrows: Map<string, FakeArrow>; querySelector: (s: string) => FakeArrow | null } = {
  body,
  activeElement: body,
  arrows: new Map(),
  querySelector(selector: string) {
    const key = /^\[data-arrow="(.+)"\]$/.exec(selector)?.[1] ?? "";
    return this.arrows.get(key) ?? null;
  },
};
const globalWithDocument = globalThis as { document?: unknown };

beforeEach(() => {
  hooks.effect = null;
  hooks.requestRender.mockClear();
  fakeDocument.activeElement = body;
  fakeDocument.arrows = new Map();
  globalWithDocument.document = fakeDocument;
});

afterEach(() => {
  delete globalWithDocument.document;
});

/** Un rendu du crochet, puis le geste, puis l'effet joué après le rendu demandé. */
function useMoveAndCommit(id: number, direction: "up" | "down") {
  const refocusArrow = useArrowRefocus("pillar");
  refocusArrow(id, direction);
  hooks.effect?.();
}

describe("useArrowRefocus", () => {
  it("useArrowRefocus_noPendingTarget_focusesNothing", () => {
    const up = makeArrow();
    fakeDocument.arrows.set("pillar:4:up", up);

    useArrowRefocus("pillar");
    hooks.effect?.();

    expect(up.focus).not.toHaveBeenCalled();
  });

  it("useArrowRefocus_focusLost_focusesPressedArrow", () => {
    const up = makeArrow();
    fakeDocument.arrows.set("pillar:4:up", up);
    fakeDocument.arrows.set("pillar:4:down", makeArrow());

    useMoveAndCommit(4, "up");

    expect(up.focus).toHaveBeenCalledTimes(1);
  });

  it("useArrowRefocus_focusOnOppositeArrow_movesToPressed", () => {
    const up = makeArrow();
    const down = makeArrow();
    fakeDocument.arrows.set("pillar:4:up", up);
    fakeDocument.arrows.set("pillar:4:down", down);
    fakeDocument.activeElement = down;

    useMoveAndCommit(4, "up");

    expect(up.focus).toHaveBeenCalledTimes(1);
  });

  it("useArrowRefocus_focusElsewhere_leavesFocus", () => {
    const up = makeArrow();
    fakeDocument.arrows.set("pillar:4:up", up);
    fakeDocument.activeElement = { tag: "toast-button" };

    useMoveAndCommit(4, "up");

    expect(up.focus).not.toHaveBeenCalled();
  });

  it("useArrowRefocus_pressedAtEdge_focusesOpposite", () => {
    const up = makeArrow(true);
    const down = makeArrow();
    fakeDocument.arrows.set("pillar:4:up", up);
    fakeDocument.arrows.set("pillar:4:down", down);

    useMoveAndCommit(4, "up");

    expect(down.focus).toHaveBeenCalledTimes(1);
    expect(up.focus).not.toHaveBeenCalled();
  });

  it("useArrowRefocus_cardGone_focusesNothing", () => {
    const other = makeArrow();
    fakeDocument.arrows.set("stat:4:up", other);

    expect(() => useMoveAndCommit(4, "up")).not.toThrow();
    expect(other.focus).not.toHaveBeenCalled();
  });

  it("useArrowRefocus_targetConsumed_secondEffectDoesNothing", () => {
    const up = makeArrow();
    fakeDocument.arrows.set("pillar:4:up", up);
    useMoveAndCommit(4, "up");

    hooks.effect?.();

    expect(up.focus).toHaveBeenCalledTimes(1);
  });

  it("useArrowRefocus_refocusArrow_requestsOneRender", () => {
    const refocusArrow = useArrowRefocus("pillar");

    refocusArrow(4, "down");

    expect(hooks.requestRender).toHaveBeenCalledTimes(1);
  });
});
