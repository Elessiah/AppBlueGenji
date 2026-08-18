import { describe, expect, it } from "@jest/globals";
import {
  inferGameCode,
  inferGameLabel,
  inferGameShortLabel,
} from "@/lib/shared/landing";

describe("inferGameLabel", () => {
  it("detects Marvel Rivals from either keyword", () => {
    expect(inferGameLabel("Marvel Rivals Open")).toBe("Marvel Rivals");
    expect(inferGameLabel("Rivals Winter Cup")).toBe("Marvel Rivals");
  });

  it("is case-insensitive", () => {
    expect(inferGameLabel("MARVEL RIVALS PRO SERIES")).toBe("Marvel Rivals");
  });

  it("falls back to Overwatch for anything else", () => {
    expect(inferGameLabel("OW Spring Clash")).toBe("Overwatch");
    expect(inferGameLabel("Genji Clash #14")).toBe("Overwatch");
  });

  it("tolerates null and undefined", () => {
    expect(inferGameLabel(null)).toBe("Overwatch");
    expect(inferGameLabel(undefined)).toBe("Overwatch");
    expect(inferGameLabel("")).toBe("Overwatch");
  });
});

describe("inferGameCode", () => {
  it("maps to the filter keys used by the landing endpoints", () => {
    expect(inferGameCode("Marvel Rivals Cup S1")).toBe("mr");
    expect(inferGameCode("OW Champions League")).toBe("ow2");
    expect(inferGameCode(null)).toBe("ow2");
  });
});

describe("inferGameShortLabel", () => {
  it("abbreviates the label for narrow pills", () => {
    expect(inferGameShortLabel("Marvel Rivals Open")).toBe("MR");
    expect(inferGameShortLabel("OW Winter Cup")).toBe("OW");
  });

  it("stays aligned with inferGameLabel", () => {
    for (const name of ["Marvel Rivals Open", "Genji Clash", "", null]) {
      const expected = inferGameLabel(name) === "Marvel Rivals" ? "MR" : "OW";
      expect(inferGameShortLabel(name)).toBe(expected);
    }
  });
});
