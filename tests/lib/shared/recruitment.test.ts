import { describe, expect, it } from "@jest/globals";
import {
  RECRUITMENT_DOMAINS,
  RECRUITMENT_HIGHLIGHTS,
  validateRecruitmentAdInput,
} from "@/lib/shared/recruitment";

describe("validateRecruitmentAdInput", () => {
  it("accepts a minimal valid input with defaults", () => {
    const result = validateRecruitmentAdInput({ title: "Recherche arbitre" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: "Recherche arbitre",
        teamName: null,
        domain: "AUTRE",
        roles: null,
        body: null,
        contactUrl: null,
        highlight: "NONE",
        active: true,
      });
    }
  });

  it("trims the title and optional fields, nulling empties", () => {
    const result = validateRecruitmentAdInput({
      title: "  Pôle arbitrage recrute  ",
      teamName: "  ",
      roles: " Arbitrage, litiges ",
      body: "",
      contactUrl: " https://discord.gg/x ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Pôle arbitrage recrute");
      expect(result.value.teamName).toBeNull();
      expect(result.value.roles).toBe("Arbitrage, litiges");
      expect(result.value.body).toBeNull();
      expect(result.value.contactUrl).toBe("https://discord.gg/x");
    }
  });

  it("accepts every valid domain", () => {
    for (const domain of RECRUITMENT_DOMAINS) {
      const result = validateRecruitmentAdInput({ title: "X", domain });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.domain).toBe(domain);
    }
  });

  it("accepts every valid highlight mode", () => {
    for (const highlight of RECRUITMENT_HIGHLIGHTS) {
      const result = validateRecruitmentAdInput({ title: "X", highlight });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.highlight).toBe(highlight);
    }
  });

  it("honours an explicit active=false", () => {
    const result = validateRecruitmentAdInput({ title: "X", active: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.active).toBe(false);
  });

  it("falls back to defaults when domain/highlight are empty strings", () => {
    const result = validateRecruitmentAdInput({ title: "X", domain: "", highlight: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.domain).toBe("AUTRE");
      expect(result.value.highlight).toBe("NONE");
    }
  });

  it("truncates an over-long body to the max length", () => {
    const result = validateRecruitmentAdInput({ title: "X", body: "a".repeat(2500) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.body).toHaveLength(2000);
  });

  it("rejects a missing title", () => {
    expect(validateRecruitmentAdInput({ title: "   " })).toEqual({
      ok: false,
      error: "TITLE_REQUIRED",
    });
  });

  it("rejects an over-long title", () => {
    expect(validateRecruitmentAdInput({ title: "a".repeat(141) })).toEqual({
      ok: false,
      error: "TITLE_TOO_LONG",
    });
  });

  it("rejects an invalid domain", () => {
    expect(validateRecruitmentAdInput({ title: "X", domain: "LOL" })).toEqual({
      ok: false,
      error: "INVALID_DOMAIN",
    });
  });

  it("rejects an invalid highlight", () => {
    expect(validateRecruitmentAdInput({ title: "X", highlight: "POPUP" })).toEqual({
      ok: false,
      error: "INVALID_HIGHLIGHT",
    });
  });
});
