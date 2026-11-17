/**
 * Focus rendu après un geste (`lib/shared/hooks/useFocusRescue.ts`) : les
 * crochets de React sont simulés (aucun DOM dans Jest), `document` remplacé
 * par un faux dont on règle l'élément actif.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

type Effect = () => void;
const hooks: { effect: Effect | null } = { effect: null };

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
    useRef: (initial: unknown) => ({ current: initial }),
  };
});

import { useFocusRescue } from "@/lib/shared/hooks/useFocusRescue";

type FakeTarget = { focus: jest.Mock<() => void> };
const makeTarget = (): FakeTarget => ({ focus: jest.fn<() => void>() });

const body = { tag: "body" };
const fakeDocument: { body: unknown; documentElement: unknown; activeElement: unknown } = {
  body,
  documentElement: { tag: "html" },
  activeElement: body,
};
const globalWithDocument = globalThis as { document?: unknown };

let targets: Record<string, FakeTarget>;
const root = { querySelector: (selector: string) => targets[selector] ?? null };
const rootRef = { current: root as unknown as HTMLElement };

beforeEach(() => {
  hooks.effect = null;
  targets = {};
  fakeDocument.activeElement = body;
  globalWithDocument.document = fakeDocument;
});

afterEach(() => {
  delete globalWithDocument.document;
  jest.restoreAllMocks();
});

describe("useFocusRescue", () => {
  it("useFocusRescue_notArmed_focusesNothing", () => {
    const next = makeTarget();
    targets.button = next;

    useFocusRescue(rootRef);
    hooks.effect?.();

    expect(next.focus).not.toHaveBeenCalled();
  });

  it("useFocusRescue_armedAndFocusLost_focusesFirstTargetOnce", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);

    arm(["button"]);
    hooks.effect?.();
    hooks.effect?.();

    expect(next.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_focusElsewhere_keepsItThenRescuesALaterLoss", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    fakeDocument.activeElement = { tag: "input" };
    hooks.effect?.();
    expect(next.focus).not.toHaveBeenCalled();

    fakeDocument.activeElement = body;
    hooks.effect?.();
    expect(next.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_targetNotYetRendered_waitsForLaterRender", () => {
    const arm = useFocusRescue(rootRef);
    arm(['[data-focus-rescue="claim"]']);
    hooks.effect?.();

    const propose = makeTarget();
    targets['[data-focus-rescue="claim"]'] = propose;
    hooks.effect?.();

    expect(propose.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_windowExpired_forgetsRequest", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const next = makeTarget();
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    now.mockReturnValue(14_001);
    hooks.effect?.();
    targets.button = next;
    now.mockReturnValue(10_001);
    hooks.effect?.();

    expect(next.focus).not.toHaveBeenCalled();
  });
});
