import { describe, expect, it, jest } from "@jest/globals";
import {
  FOCUS_RESCUE_WINDOW_MS,
  armedRescueSelector,
  neighbourRescueSelectors,
  pickRescueTarget,
  rescueDue,
  rescueExpired,
  type FocusRescueRoot,
  type FocusRescueTarget,
} from "@/lib/shared/focus-rescue";

/** Focus rendu après un geste dont le bouton disparaît : logique pure (`lib/shared/focus-rescue.ts`). */

const target = (): FocusRescueTarget => ({ focus: jest.fn<() => void>() });
const rootWith = (targets: Record<string, FocusRescueTarget>): FocusRescueRoot => ({
  querySelector: (selector) => targets[selector] ?? null,
});

describe("rescueDue", () => {
  it("rescueDue_noRescue_returnsFalse", () => {
    expect(rescueDue(null, 1_000, true)).toBe(false);
  });

  it("rescueDue_atDeadlineAndFocusLost_returnsTrue", () => {
    expect(rescueDue({ until: 5_000, selectors: ["button"] }, 5_000, true)).toBe(true);
  });

  it("rescueDue_oneMsAfterDeadline_returnsFalse", () => {
    expect(rescueDue({ until: 5_000, selectors: ["button"] }, 5_001, true)).toBe(false);
  });

  it("rescueDue_focusTakenElsewhere_returnsFalse", () => {
    expect(rescueDue({ until: 5_000, selectors: ["button"] }, 1_000, false)).toBe(false);
  });
});

describe("rescueExpired", () => {
  it("rescueExpired_noRescue_returnsFalse", () => {
    expect(rescueExpired(null, 9_999)).toBe(false);
  });

  it("rescueExpired_atDeadline_returnsFalse", () => {
    expect(rescueExpired({ until: 5_000, selectors: [] }, 5_000)).toBe(false);
  });

  it("rescueExpired_afterDeadline_returnsTrue", () => {
    expect(rescueExpired({ until: 5_000, selectors: [] }, 5_001)).toBe(true);
  });

  it("windowMs_coversASlowReload", () => {
    expect(FOCUS_RESCUE_WINDOW_MS).toBe(4_000);
  });
});

describe("pickRescueTarget", () => {
  it("pickRescueTarget_nullRoot_returnsNull", () => {
    expect(pickRescueTarget(null, ["button"])).toBeNull();
  });

  it("pickRescueTarget_firstSelectorMissing_returnsSecondMatch", () => {
    const field = target();

    expect(pickRescueTarget(rootWith({ "#pseudo": field }), ['[data-focus-rescue="invitation"]', "#pseudo"])).toBe(field);
  });

  it("pickRescueTarget_bothMatch_prefersFirstSelector", () => {
    const next = target();
    const field = target();

    expect(pickRescueTarget(rootWith({ button: next, "#pseudo": field }), ["button", "#pseudo"])).toBe(next);
  });

  it("pickRescueTarget_noMatch_returnsNull", () => {
    expect(pickRescueTarget(rootWith({}), ["button", "a[href]"])).toBeNull();
  });
});

describe("armedRescueSelector", () => {
  it("armedRescueSelector_kind_excludesAriaDisabledButtons", () => {
    expect(armedRescueSelector("membership")).toBe('[data-focus-rescue="membership"]:not([aria-disabled="true"])');
  });
});

describe("neighbourRescueSelectors", () => {
  const ARMED = '[data-focus-rescue="invitation"]:not([aria-disabled="true"])';
  const ANY = '[data-focus-rescue="invitation"]';
  const row = (key: number) => `[data-focus-rescue="invitation"][data-focus-rescue-key="${key}"]`;

  it("neighbourRescueSelectors_middleRow_nextThenPreviousThenArmedThenAny", () => {
    expect(neighbourRescueSelectors("invitation", [1, 2, 3], 2)).toEqual([row(3), row(1), ARMED, ANY]);
  });

  it("neighbourRescueSelectors_lastRow_previousThenFallbacks", () => {
    expect(neighbourRescueSelectors("invitation", [1, 2, 3], 3)).toEqual([row(2), ARMED, ANY]);
  });

  it("neighbourRescueSelectors_firstRow_nextThenFallbacks", () => {
    expect(neighbourRescueSelectors("invitation", [1, 2, 3], 1)).toEqual([row(2), ARMED, ANY]);
  });

  it("neighbourRescueSelectors_onlyRow_fallbacksOnly", () => {
    expect(neighbourRescueSelectors("invitation", [5], 5)).toEqual([ARMED, ANY]);
  });

  it("neighbourRescueSelectors_unknownKey_fallbacksOnly", () => {
    expect(neighbourRescueSelectors("invitation", [1, 2], 9)).toEqual([ARMED, ANY]);
  });

  it("neighbourRescueSelectors_stringAndNumberKeys_matchByValue", () => {
    expect(neighbourRescueSelectors("invitation", ["1", 2], 1)).toEqual([row(2), ARMED, ANY]);
  });

  it("pickRescueTarget_neighbourChainWithNextGone_returnsPrevious", () => {
    const previous = target();

    const picked = pickRescueTarget(rootWith({ [row(1)]: previous }), neighbourRescueSelectors("invitation", [1, 2, 3], 2));

    expect(picked).toBe(previous);
  });
});
