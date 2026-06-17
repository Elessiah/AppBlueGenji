import { describe, expect, it } from "@jest/globals";
import {
  SPONSOR_TIERS,
  slugifySponsor,
  validateSponsorInput,
} from "@/lib/shared/sponsors";

describe("slugifySponsor", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifySponsor("Logitech G")).toBe("logitech-g");
  });

  it("strips accents", () => {
    expect(slugifySponsor("Société Générale")).toBe("societe-generale");
  });

  it("removes leading/trailing separators and collapses runs", () => {
    expect(slugifySponsor("  ASUS  ROG!! ")).toBe("asus-rog");
  });

  it("drops non-alphanumeric characters", () => {
    expect(slugifySponsor("AT&T")).toBe("at-t");
  });
});

describe("validateSponsorInput", () => {
  it("accepts a minimal valid input with defaults", () => {
    const result = validateSponsorInput({ name: "HyperX" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "HyperX",
        tier: "PARTNER",
        logoUrl: null,
        websiteUrl: null,
        description: null,
        active: true,
      });
    }
  });

  it("trims the name and optional fields, nulling empties", () => {
    const result = validateSponsorInput({
      name: "  Razer ",
      websiteUrl: "  ",
      logoUrl: " https://x/y.png ",
      description: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Razer");
      expect(result.value.websiteUrl).toBeNull();
      expect(result.value.logoUrl).toBe("https://x/y.png");
      expect(result.value.description).toBeNull();
    }
  });

  it("accepts every valid tier", () => {
    for (const tier of SPONSOR_TIERS) {
      const result = validateSponsorInput({ name: "X", tier });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.tier).toBe(tier);
    }
  });

  it("honours an explicit active=false", () => {
    const result = validateSponsorInput({ name: "X", active: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.active).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(validateSponsorInput({ name: "   " })).toEqual({ ok: false, error: "NAME_REQUIRED" });
  });

  it("rejects an over-long name", () => {
    expect(validateSponsorInput({ name: "a".repeat(121) })).toEqual({ ok: false, error: "NAME_TOO_LONG" });
  });

  it("rejects an invalid tier", () => {
    expect(validateSponsorInput({ name: "X", tier: "PLATINUM" })).toEqual({ ok: false, error: "INVALID_TIER" });
  });

  it("falls back to PARTNER when tier is empty string", () => {
    const result = validateSponsorInput({ name: "X", tier: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tier).toBe("PARTNER");
  });
});
