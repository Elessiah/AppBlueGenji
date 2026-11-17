import { describe, expect, it } from "@jest/globals";
import {
  ACTIONS_SCOPE,
  focusAfterGesture,
  gestureStarted,
  gestureState,
  pressedGestureOf,
  reportGesture,
} from "@/app/(secured)/admin/signalements/_lib/report-gestures";

/**
 * Gestes du panneau des signalements (EF-70, `BUSY_BUTTONS.md`) : seul le geste
 * en attente s'annonce occupé, et le focus revient au geste — ou à ce qui le
 * remplace — quand la relecture du dossier a retiré le bouton pressé.
 */

/** Élément minimal : `closest` et `getAttribute`, comme le DOM. */
type FakeElement = { closest: (selector: string) => FakeElement | null; getAttribute: (name: string) => string | null };
function fakeElement(attributes: Record<string, string>, parents: Record<string, FakeElement> = {}): FakeElement {
  const self: FakeElement = {
    getAttribute: (name) => attributes[name] ?? null,
    closest: (selector) => {
      const name = selector.slice(1, -1);
      return name in attributes ? self : (parents[selector] ?? null);
    },
  };
  return self;
}
const asTarget = (element: FakeElement) => element as unknown as EventTarget;

/** Racine minimale : `querySelector` sur une table sélecteur → élément. */
function fakeRoot(found: Record<string, HTMLElement>): ParentNode {
  return { querySelector: (selector: string) => found[selector] ?? null } as unknown as ParentNode;
}
const button = (name: string) => ({ name }) as unknown as HTMLElement;
const ACTIONS_BUTTON = '[data-focus-scope="' + ACTIONS_SCOPE + '"] button';

describe("gestureState", () => {
  it("gestureState_noPending_armed", () => {
    expect(gestureState(null, "action:TAKE")).toEqual({ busy: false, blocked: false });
  });

  it("gestureState_samePending_busyAndBlocked", () => {
    expect(gestureState("action:TAKE", "action:TAKE")).toEqual({ busy: true, blocked: true });
  });

  it("gestureState_otherPending_blockedNotBusy", () => {
    expect(gestureState("purge:4", "action:TAKE")).toEqual({ busy: false, blocked: true });
  });
});

describe("reportGesture", () => {
  it("reportGesture_names_distinctPerTargetTypeAndOutcome", () => {
    expect(reportGesture.hide({ type: "TEAM", id: 3 })).toBe("hide:TEAM-3");
    expect(reportGesture.hide({ type: "USER", id: 3 })).toBe("hide:USER-3");
    expect(reportGesture.remove({ type: "TEAM", id: 3 })).toBe("remove:TEAM-3");
    expect(reportGesture.outcome(9, "UPHELD")).toBe("outcome:9:UPHELD");
    expect(reportGesture.outcome(9, "OVERTURNED")).toBe("outcome:9:OVERTURNED");
    expect(reportGesture.action("TAKE")).toBe("action:TAKE");
  });
});

describe("pressedGestureOf", () => {
  it("pressedGestureOf_insideGestureButton_returnsGestureAndScope", () => {
    const scope = fakeElement({ "data-focus-scope": "target:TEAM-3" });
    const pressed = fakeElement({ "data-gesture": "hide:TEAM-3" }, { "[data-focus-scope]": scope });
    const label = fakeElement({}, { "[data-gesture]": pressed });

    expect(pressedGestureOf(asTarget(label))).toEqual({ gesture: "hide:TEAM-3", scope: "target:TEAM-3" });
  });

  it("pressedGestureOf_noScope_returnsNullScope", () => {
    const pressed = fakeElement({ "data-gesture": "action:TAKE" });

    expect(pressedGestureOf(asTarget(pressed))).toEqual({ gesture: "action:TAKE", scope: null });
  });

  it("pressedGestureOf_outsideGestureButton_returnsNull", () => {
    expect(pressedGestureOf(asTarget(fakeElement({})))).toBeNull();
  });

  it("pressedGestureOf_targetWithoutClosest_returnsNull", () => {
    expect(pressedGestureOf({} as EventTarget)).toBeNull();
    expect(pressedGestureOf(null)).toBeNull();
  });
});

describe("focusAfterGesture", () => {
  const pressed = { gesture: "hide:TEAM-3", scope: "target:TEAM-3" };

  it("focusAfterGesture_sameGestureStillThere_returnsIt", () => {
    const same = button("same");
    const root = fakeRoot({
      '[data-gesture="hide:TEAM-3"]': same,
      '[data-focus-scope="target:TEAM-3"] button': button("scope"),
    });

    expect(focusAfterGesture(root, pressed)).toBe(same);
  });

  it("focusAfterGesture_gestureGone_returnsFirstButtonOfScope", () => {
    const restore = button("restore");
    const root = fakeRoot({ '[data-focus-scope="target:TEAM-3"] button': restore, [ACTIONS_BUTTON]: button("actions") });

    expect(focusAfterGesture(root, pressed)).toBe(restore);
  });

  it("focusAfterGesture_scopeGone_returnsFirstActionButton", () => {
    const reopen = button("reopen");

    expect(focusAfterGesture(fakeRoot({ [ACTIONS_BUTTON]: reopen }), pressed)).toBe(reopen);
  });

  it("focusAfterGesture_noScopeRecorded_returnsFirstActionButton", () => {
    const release = button("release");

    expect(focusAfterGesture(fakeRoot({ [ACTIONS_BUTTON]: release }), { gesture: "action:TAKE", scope: null })).toBe(release);
  });

  it("focusAfterGesture_nothingLeft_returnsNull", () => {
    expect(focusAfterGesture(fakeRoot({}), pressed)).toBeNull();
  });
});

describe("gestureStarted", () => {
  const clicked = { gesture: "remove:TEAM-3", scope: "target:TEAM-3" };

  it("gestureStarted_clickedMatchesPending_returnsClicked", () => {
    expect(gestureStarted(clicked, "remove:TEAM-3")).toBe(clicked);
  });

  it("gestureStarted_noPending_returnsNull", () => {
    // Premier clic de « Supprimer… » : il arme le bouton, rien ne part.
    expect(gestureStarted(clicked, null)).toBeNull();
  });

  it("gestureStarted_pendingOtherGesture_returnsNull", () => {
    // Clic refusé pendant un autre geste, ou « Actualiser » hors du dossier.
    expect(gestureStarted(clicked, "refresh")).toBeNull();
  });

  it("gestureStarted_noClicked_returnsNull", () => {
    expect(gestureStarted(null, "action:TAKE")).toBeNull();
  });
});
