import { describe, expect, it } from "@jest/globals";
import { gestureState } from "@/lib/shared/gesture-state";

/** Un geste nommé à la fois (`lib/shared/gesture-state.ts`), commun aux signalements et à la fiche d'équipe. */
describe("gestureState", () => {
  it("gestureState_noPending_armed", () => {
    expect(gestureState(null, "join")).toEqual({ busy: false, blocked: false });
  });

  it("gestureState_samePending_busy", () => {
    expect(gestureState("join", "join")).toEqual({ busy: true, blocked: true });
  });

  it("gestureState_otherPending_blockedNotBusy", () => {
    expect(gestureState("accept-4", "refuse-4")).toEqual({ busy: false, blocked: true });
  });
});
