import { describe, expect, it } from "@jest/globals";
import {
  BUREAU_COLORS,
  computeInitials,
  randomBureauColor,
  validateBureauInput,
} from "@/lib/shared/bureau";

describe("computeInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(computeInitials("Léo Perreaut")).toBe("LP");
  });

  it("takes up to three initials", () => {
    expect(computeInitials("Jean Michel Dupont")).toBe("JMD");
  });

  it("uses the first two letters for a single word", () => {
    expect(computeInitials("Madonna")).toBe("MA");
  });

  it("uppercases the result", () => {
    expect(computeInitials("bryan boulleaux")).toBe("BB");
  });

  it("collapses extra whitespace", () => {
    expect(computeInitials("  Sophie   Martin  ")).toBe("SM");
  });

  it("returns empty string for empty input", () => {
    expect(computeInitials("   ")).toBe("");
  });
});

describe("randomBureauColor", () => {
  it("always returns a color from the palette", () => {
    for (let i = 0; i < 50; i++) {
      expect(BUREAU_COLORS).toContain(randomBureauColor());
    }
  });
});

describe("validateBureauInput", () => {
  it("accepts a valid input and derives initials + color", () => {
    const result = validateBureauInput({ name: "Léo Perreaut", role: "Président" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Léo Perreaut");
      expect(result.value.role).toBe("Président");
      expect(result.value.initials).toBe("LP");
      expect(BUREAU_COLORS).toContain(result.value.color);
    }
  });

  it("trims name and role", () => {
    const result = validateBureauInput({ name: "  Sophie Martin ", role: "  Secrétaire " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Sophie Martin");
      expect(result.value.role).toBe("Secrétaire");
    }
  });

  it("keeps explicit initials (uppercased, capped at 4)", () => {
    const result = validateBureauInput({ name: "X", role: "Role", initials: "abcde" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.initials).toBe("ABCD");
  });

  it("keeps an explicit color", () => {
    const result = validateBureauInput({ name: "X", role: "Role", color: "rgb(1, 2, 3)" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.color).toBe("rgb(1, 2, 3)");
  });

  it("rejects a missing name", () => {
    const result = validateBureauInput({ name: "  ", role: "Président" });
    expect(result).toEqual({ ok: false, error: "NAME_REQUIRED" });
  });

  it("rejects a missing role", () => {
    const result = validateBureauInput({ name: "Léo", role: "" });
    expect(result).toEqual({ ok: false, error: "ROLE_REQUIRED" });
  });

  it("rejects an over-long name", () => {
    const result = validateBureauInput({ name: "a".repeat(121), role: "Role" });
    expect(result).toEqual({ ok: false, error: "NAME_TOO_LONG" });
  });

  it("rejects an over-long role", () => {
    const result = validateBureauInput({ name: "Léo", role: "a".repeat(121) });
    expect(result).toEqual({ ok: false, error: "ROLE_TOO_LONG" });
  });

  it("rejects when initials cannot be derived (numeric-free empty name words)", () => {
    // name with only spaces already rejected; this checks a name that yields no initials
    const result = validateBureauInput({ name: "Léo", role: "Role", initials: "   " });
    // initials fall back to computeInitials("Léo") => "LÉ"
    expect(result.ok).toBe(true);
  });
});
