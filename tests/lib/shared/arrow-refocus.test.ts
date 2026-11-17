import { describe, expect, it } from "@jest/globals";
import { arrowKey, pickArrowTarget, type ArrowCandidate } from "@/lib/shared/arrow-refocus";

/** Flèche simulée : seul `data-edge` compte pour le choix. */
const arrow = (name: string, edge = false): ArrowCandidate & { name: string } => ({
  name,
  dataset: edge ? { edge: "true" } : {},
});

describe("arrowKey", () => {
  it("arrowKey_listIdDirection_joinsWithColons", () => {
    expect(arrowKey("pillar", 12, "up")).toBe("pillar:12:up");
  });
});

describe("pickArrowTarget", () => {
  it("pickArrowTarget_pressedNotAtEdge_returnsPressed", () => {
    const pressed = arrow("pressed");

    expect(pickArrowTarget(pressed, arrow("opposite"))).toBe(pressed);
  });

  it("pickArrowTarget_pressedAtEdge_returnsOpposite", () => {
    const opposite = arrow("opposite");

    expect(pickArrowTarget(arrow("pressed", true), opposite)).toBe(opposite);
  });

  it("pickArrowTarget_pressedAtEdgeNoOpposite_returnsPressed", () => {
    const pressed = arrow("pressed", true);

    expect(pickArrowTarget(pressed, null)).toBe(pressed);
  });

  it("pickArrowTarget_pressedMissing_returnsOpposite", () => {
    const opposite = arrow("opposite");

    expect(pickArrowTarget(null, opposite)).toBe(opposite);
  });

  it("pickArrowTarget_bothMissing_returnsNull", () => {
    expect(pickArrowTarget(null, null)).toBeNull();
  });
});
