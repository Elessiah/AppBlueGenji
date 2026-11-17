/**
 * Focus rendu après un geste (`lib/shared/hooks/useFocusRescue.ts`) : les
 * crochets de React sont simulés (aucun DOM dans Jest), `document` remplacé
 * par un faux dont on règle l'élément actif et dont on suit les écouteurs.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

type Effect = () => void | (() => void);
// Effets dans l'ordre d'appel : le montage (son retour est le démontage),
// puis celui de chaque rendu. Sans `window` (Jest), le crochet passe le second
// par `useEffect` lui aussi.
const effects: Effect[] = [];
const hooks = {
  get mount(): Effect | undefined {
    return effects[0];
  },
  get render(): Effect | undefined {
    return effects[1];
  },
};

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  const register = (effect: Effect) => {
    effects.push(effect);
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

type Listener = () => void;
type FakeTarget = { focus: jest.Mock<() => void> };
const makeTarget = (): FakeTarget => ({ focus: jest.fn<() => void>() });

const body = { tag: "body" };
const listeners = new Map<string, Set<Listener>>();
const fakeDocument = {
  body,
  documentElement: { tag: "html" },
  activeElement: body as unknown,
  addEventListener: (type: string, listener: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)?.add(listener);
  },
  removeEventListener: (type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  },
};
const globalWithDocument = globalThis as { document?: unknown };
const fire = (type: string) => {
  for (const listener of [...(listeners.get(type) ?? [])]) listener();
};
const listening = () => (listeners.get("pointerdown")?.size ?? 0) + (listeners.get("keydown")?.size ?? 0);
const render = () => hooks.render?.();

let targets: Record<string, FakeTarget>;
const root = { querySelector: (selector: string) => targets[selector] ?? null };
const rootRef = { current: root as unknown as HTMLElement };

beforeEach(() => {
  effects.length = 0;
  targets = {};
  listeners.clear();
  fakeDocument.activeElement = body;
  globalWithDocument.document = fakeDocument;
});

afterEach(() => {
  // Démonte : le minuteur d'expiration réel ne doit pas survivre au faux `document`.
  const unmount = hooks.mount?.();
  if (typeof unmount === "function") unmount();
  delete globalWithDocument.document;
  jest.restoreAllMocks();
});

describe("useFocusRescue", () => {
  it("useFocusRescue_notArmed_focusesNothing", () => {
    const next = makeTarget();
    targets.button = next;

    useFocusRescue(rootRef);
    render();

    expect(next.focus).not.toHaveBeenCalled();
  });

  it("useFocusRescue_armedAndFocusLost_focusesFirstTargetOnce", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);

    arm(["button"]);
    render();
    render();

    expect(next.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_focusStillOnPressedButton_waitsForLaterLoss", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    fakeDocument.activeElement = { tag: "button" };
    render();
    expect(next.focus).not.toHaveBeenCalled();

    fakeDocument.activeElement = body;
    render();
    expect(next.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_userKeydownAfterArm_dropsRequest", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    fire("keydown");
    render();

    expect(next.focus).not.toHaveBeenCalled();
  });

  it("useFocusRescue_userPointerdownAfterArm_dropsRequest", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    fire("pointerdown");
    render();

    expect(next.focus).not.toHaveBeenCalled();
  });

  it("useFocusRescue_targetNotYetRendered_waitsForLaterRender", () => {
    const arm = useFocusRescue(rootRef);
    arm(['[data-focus-rescue="claim"]']);
    render();

    const propose = makeTarget();
    targets['[data-focus-rescue="claim"]'] = propose;
    render();

    expect(propose.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_windowExpired_forgetsRequest", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const next = makeTarget();
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    now.mockReturnValue(14_001);
    render();
    targets.button = next;
    now.mockReturnValue(10_001);
    render();

    expect(next.focus).not.toHaveBeenCalled();
  });

  it("useFocusRescue_armed_listensToKeydownAndPointerdown", () => {
    const arm = useFocusRescue(rootRef);

    arm(["button"]);

    expect(listening()).toBe(2);
  });

  it("useFocusRescue_consumed_detachesListeners", () => {
    targets.button = makeTarget();
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    render();

    expect(listening()).toBe(0);
  });

  it("useFocusRescue_expired_detachesListeners", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    now.mockReturnValue(14_001);
    render();

    expect(listening()).toBe(0);
  });

  it("useFocusRescue_rearmed_keepsOnlyTheNewListeners", () => {
    const arm = useFocusRescue(rootRef);

    arm(["button"]);
    arm(["a[href]"]);

    expect(listening()).toBe(2);
  });

  it("useFocusRescue_unmounted_detachesListeners", () => {
    const arm = useFocusRescue(rootRef);
    const unmount = hooks.mount?.();
    arm(["button"]);

    if (typeof unmount === "function") unmount();

    expect(listening()).toBe(0);
  });

  it("useFocusRescue_armedAfterUnmount_attachesNothing", () => {
    const arm = useFocusRescue(rootRef);
    const unmount = hooks.mount?.();
    if (typeof unmount === "function") unmount();

    arm(["button"]);

    expect(listening()).toBe(0);
  });

  it("useFocusRescue_noRenderAfterWindow_detachesListenersByTimer", () => {
    jest.useFakeTimers();
    try {
      const arm = useFocusRescue(rootRef);
      arm(["button"]);
      expect(listening()).toBe(2);

      jest.advanceTimersByTime(4_001);

      expect(listening()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("useFocusRescue_consumed_cancelsTimer", () => {
    jest.useFakeTimers();
    try {
      targets.button = makeTarget();
      const arm = useFocusRescue(rootRef);
      arm(["button"]);
      render();

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("useFocusRescue_trackedDataUnchanged_waitsForReload", () => {
    const next = makeTarget();
    targets.button = next;
    const data: unknown[] = [{ id: 1 }];
    const arm = useFocusRescue(rootRef, data);
    arm(["button"]);

    // La fenêtre se ferme avant la relecture : focus tombé, données identiques.
    render();
    expect(next.focus).not.toHaveBeenCalled();

    data[0] = { id: 1 };
    render();
    expect(next.focus).toHaveBeenCalledTimes(1);
  });

  it("useFocusRescue_armNull_dropsRequestAndListeners", () => {
    const next = makeTarget();
    targets.button = next;
    const arm = useFocusRescue(rootRef);
    arm(["button"]);

    arm(null);
    render();

    expect(next.focus).not.toHaveBeenCalled();
    expect(listening()).toBe(0);
  });
});
