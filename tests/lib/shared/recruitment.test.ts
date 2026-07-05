import { describe, expect, it } from "@jest/globals";
import {
  RECRUITMENT_GAMES,
  RECRUITMENT_HIGHLIGHTS,
  validateRecruitmentAdInput,
} from "@/lib/shared/recruitment";

describe("validateRecruitmentAdInput", () => {
  it("accepts a minimal valid input with defaults", () => {
    const result = validateRecruitmentAdInput({ title: "Recherche TANK" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: "Recherche TANK",
        teamName: null,
        game: "ANY",
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
      title: "  Team Sakura recrute  ",
      teamName: "  ",
      roles: " TANK, HEAL ",
      body: "",
      contactUrl: " https://discord.gg/x ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Team Sakura recrute");
      expect(result.value.teamName).toBeNull();
      expect(result.value.roles).toBe("TANK, HEAL");
      expect(result.value.body).toBeNull();
      expect(result.value.contactUrl).toBe("https://discord.gg/x");
    }
  });

  it("accepts every valid game", () => {
    for (const game of RECRUITMENT_GAMES) {
      const result = validateRecruitmentAdInput({ title: "X", game });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.game).toBe(game);
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

  it("falls back to defaults when game/highlight are empty strings", () => {
    const result = validateRecruitmentAdInput({ title: "X", game: "", highlight: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.game).toBe("ANY");
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

  it("rejects an invalid game", () => {
    expect(validateRecruitmentAdInput({ title: "X", game: "LOL" })).toEqual({
      ok: false,
      error: "INVALID_GAME",
    });
  });

  it("rejects an invalid highlight", () => {
    expect(validateRecruitmentAdInput({ title: "X", highlight: "POPUP" })).toEqual({
      ok: false,
      error: "INVALID_HIGHLIGHT",
    });
  });
});
