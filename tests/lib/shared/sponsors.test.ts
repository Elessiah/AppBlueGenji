import { describe, expect, it } from "@jest/globals";
import {
  FALLBACK_SPONSORS,
  SPONSOR_DESCRIPTION_MAX,
  SPONSOR_TIERS,
  isStoredSponsorBanner,
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
        bannerUrl: null,
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

describe("validateSponsorInput — bandeau", () => {
  it("accepts an uploaded banner, served or disk form", () => {
    for (const bannerUrl of ["/api/uploads/sponsors/1-a.webp", "/uploads/sponsors/1-a.webp"]) {
      const result = validateSponsorInput({ name: "X", bannerUrl: ` ${bannerUrl} ` });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.bannerUrl).toBe(bannerUrl);
    }
  });

  it("nulls an empty banner", () => {
    const result = validateSponsorInput({ name: "X", bannerUrl: "  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.bannerUrl).toBeNull();
  });

  it.each([
    "https://cdn.example.com/banner.png",
    "//cdn.example.com/banner.png",
    "/api/uploads/avatars/1-a.webp",
    "/uploads/teams/1-a.webp",
    "/api/uploads/sponsors/../avatars/1-a.webp",
    `/api/uploads/sponsors/${"a".repeat(260)}.webp`,
  ])("refuses %s (not a sponsor upload)", (bannerUrl) => {
    expect(validateSponsorInput({ name: "X", bannerUrl })).toEqual({ ok: false, error: "INVALID_BANNER_URL" });
  });
});

describe("validateSponsorInput — description", () => {
  it("accepts a description at the limit", () => {
    const description = "d".repeat(SPONSOR_DESCRIPTION_MAX);
    const result = validateSponsorInput({ name: "X", description });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBe(description);
  });

  it("refuses rather than truncates a description over the limit", () => {
    expect(validateSponsorInput({ name: "X", description: "d".repeat(SPONSOR_DESCRIPTION_MAX + 1) })).toEqual({
      ok: false,
      error: "DESCRIPTION_TOO_LONG",
    });
  });

  it("measures the trimmed description", () => {
    const result = validateSponsorInput({ name: "X", description: `  ${"d".repeat(SPONSOR_DESCRIPTION_MAX)}  ` });
    expect(result.ok).toBe(true);
  });
});

describe("isStoredSponsorBanner", () => {
  it("only accepts the sponsors upload folder", () => {
    expect(isStoredSponsorBanner("/api/uploads/sponsors/x.webp")).toBe(true);
    expect(isStoredSponsorBanner("/uploads/sponsors/x.webp")).toBe(true);
    expect(isStoredSponsorBanner("/api/uploads/tournaments/x.webp")).toBe(false);
    expect(isStoredSponsorBanner("https://x/y.webp")).toBe(false);
  });
});

describe("FALLBACK_SPONSORS", () => {
  it("carry no banner", () => {
    expect(FALLBACK_SPONSORS.every((s) => s.bannerUrl === null)).toBe(true);
  });
});
