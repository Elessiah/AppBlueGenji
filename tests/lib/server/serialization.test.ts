import { describe, it, expect } from "@jest/globals";
import {
  nextPowerOfTwo,
  generateSeedOrder,
  normalizePseudo,
  slugifyPseudo,
  toIso,
  clampInt,
  parseRoles,
} from "@/lib/server/serialization";

describe("serialization", () => {
  describe("nextPowerOfTwo", () => {
    it("returns 1 for n=0", () => expect(nextPowerOfTwo(0)).toBe(1));
    it("returns 1 for n=1", () => expect(nextPowerOfTwo(1)).toBe(1));
    it("returns 2 for n=2", () => expect(nextPowerOfTwo(2)).toBe(2));
    it("returns 4 for n=3", () => expect(nextPowerOfTwo(3)).toBe(4));
    it("returns 4 for n=4", () => expect(nextPowerOfTwo(4)).toBe(4));
    it("returns 8 for n=5", () => expect(nextPowerOfTwo(5)).toBe(8));
    it("returns 8 for n=7", () => expect(nextPowerOfTwo(7)).toBe(8));
    it("returns 8 for n=8", () => expect(nextPowerOfTwo(8)).toBe(8));
    it("returns 16 for n=16", () => expect(nextPowerOfTwo(16)).toBe(16));
    it("returns 32 for n=31", () => expect(nextPowerOfTwo(31)).toBe(32));
    it("returns 32 for n=32", () => expect(nextPowerOfTwo(32)).toBe(32));
  });

  describe("generateSeedOrder", () => {
    it("returns [1] for size <= 1", () => {
      expect(generateSeedOrder(0)).toEqual([1]);
      expect(generateSeedOrder(1)).toEqual([1]);
    });

    it("returns [1, 2] for size=2", () => {
      expect(generateSeedOrder(2)).toEqual([1, 2]);
    });

    it("returns correct order for size=4", () => {
      expect(generateSeedOrder(4)).toEqual([1, 4, 2, 3]);
    });

    it("returns correct order for size=8", () => {
      expect(generateSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    });

    it("returns correct order for size=16", () => {
      expect(generateSeedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
    });

    it("sum of seeds per round equals size+1", () => {
      const sizes = [2, 4, 8, 16];
      for (const size of sizes) {
        const order = generateSeedOrder(size);
        for (let i = 0; i < size / 2; i++) {
          const sum = order[2 * i] + order[2 * i + 1];
          expect(sum).toBe(size + 1);
        }
      }
    });
  });

  describe("normalizePseudo", () => {
    it("trims whitespace", () => {
      expect(normalizePseudo("  hello  ")).toBe("hello");
    });

    it("collapses multiple spaces", () => {
      expect(normalizePseudo("hello   world")).toBe("hello world");
    });

    it("preserves case", () => {
      expect(normalizePseudo("HeLLo")).toBe("HeLLo");
    });

    it("handles empty string", () => {
      expect(normalizePseudo("")).toBe("");
    });

    it("handles only spaces", () => {
      expect(normalizePseudo("   ")).toBe("");
    });
  });

  describe("slugifyPseudo", () => {
    it("removes accents", () => {
      expect(slugifyPseudo("café")).toBe("cafe");
      expect(slugifyPseudo("naïve")).toBe("naive");
    });

    it("removes special characters", () => {
      expect(slugifyPseudo("hello@world!")).toBe("helloworld");
      expect(slugifyPseudo("test#123")).toBe("test123");
    });

    it("keeps alphanumeric, underscore, and dash", () => {
      expect(slugifyPseudo("hello-world_123")).toBe("hello-world_123");
    });

    it("limits to 40 characters", () => {
      const long = "a".repeat(50);
      expect(slugifyPseudo(long)).toBe("a".repeat(40));
    });

    it("handles unicode normalization", () => {
      expect(slugifyPseudo("Ç")).toBe("C");
    });
  });

  describe("toIso", () => {
    it("returns null for null input", () => {
      expect(toIso(null)).toBeNull();
    });

    it("returns null for falsy input", () => {
      expect(toIso("")).toBeNull();
    });

    it("converts Date to ISO string", () => {
      const date = new Date("2026-01-01T12:00:00Z");
      expect(toIso(date)).toBe("2026-01-01T12:00:00.000Z");
    });

    it("converts ISO string to canonical ISO", () => {
      expect(toIso("2026-01-01T12:00:00Z")).toBe("2026-01-01T12:00:00.000Z");
    });

    it("handles invalid date gracefully", () => {
      expect(() => toIso("invalid-date")).toThrow();
    });
  });

  describe("clampInt", () => {
    it("returns min when value is below min", () => {
      expect(clampInt(5, 10, 20)).toBe(10);
    });

    it("returns max when value is above max", () => {
      expect(clampInt(25, 10, 20)).toBe(20);
    });

    it("returns value when within range", () => {
      expect(clampInt(15, 10, 20)).toBe(15);
    });

    it("truncates decimal values", () => {
      expect(clampInt(15.9, 10, 20)).toBe(15);
      expect(clampInt(15.1, 10, 20)).toBe(15);
    });

    it("returns min for non-numeric values", () => {
      expect(clampInt("not-a-number", 10, 20)).toBe(10);
      expect(clampInt(null, 10, 20)).toBe(10);
    });

    it("handles string numbers", () => {
      expect(clampInt("15", 10, 20)).toBe(15);
    });
  });

  describe("parseRoles", () => {
    it("returns empty array for null", () => {
      expect(parseRoles(null)).toEqual([]);
    });

    it("returns empty array for non-array, non-string", () => {
      expect(parseRoles(123)).toEqual([]);
      expect(parseRoles({})).toEqual([]);
    });

    it("filters valid roles from array", () => {
      expect(parseRoles(["TANK", "DPS", "INVALID"])).toEqual(["TANK", "DPS"]);
    });

    it("parses JSON string", () => {
      expect(parseRoles('["TANK", "HEAL"]')).toEqual(["TANK", "HEAL"]);
    });

    it("ignores invalid roles in JSON string", () => {
      expect(parseRoles('["TANK", "INVALID", "DPS"]')).toEqual(["TANK", "DPS"]);
    });

    it("returns empty array for invalid JSON string", () => {
      expect(parseRoles("{invalid json")).toEqual([]);
    });

    it("returns empty array for JSON string that is not an array", () => {
      expect(parseRoles('{"key": "value"}')).toEqual([]);
    });

    it("recognizes all valid team roles", () => {
      const allRoles = ["COACH", "TANK", "DPS", "HEAL", "CAPITAINE", "MANAGER", "OWNER"];
      expect(parseRoles(allRoles)).toEqual(allRoles);
    });
  });
});
