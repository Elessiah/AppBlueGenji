import { describe, expect, it } from "@jest/globals";
import {
  RECRUITMENT_BODY_MAX,
  RECRUITMENT_CONTACT_CHANNELS,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_HIGHLIGHTS,
  RECRUITMENT_MODAL_INTERVAL_MS,
  shouldShowRecruitmentModal,
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
        contactDiscord: null,
        contactDiscordId: null,
        contactPreferred: "AUTO",
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
    const result = validateRecruitmentAdInput({
      title: "X",
      body: "a".repeat(RECRUITMENT_BODY_MAX + 500),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.body).toHaveLength(RECRUITMENT_BODY_MAX);
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

  it("trims and keeps the Discord contact", () => {
    const result = validateRecruitmentAdInput({ title: "X", contactDiscord: "  marie#0001  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscord).toBe("marie#0001");
  });

  it("nulls an empty Discord contact", () => {
    const result = validateRecruitmentAdInput({ title: "X", contactDiscord: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscord).toBeNull();
  });

  it("truncates an over-long Discord contact to the max length", () => {
    const result = validateRecruitmentAdInput({ title: "X", contactDiscord: "a".repeat(200) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscord).toHaveLength(120);
  });

  it("accepts every valid contact channel and defaults to AUTO", () => {
    for (const channel of RECRUITMENT_CONTACT_CHANNELS) {
      const result = validateRecruitmentAdInput({ title: "X", contactPreferred: channel });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.contactPreferred).toBe(channel);
    }
    const empty = validateRecruitmentAdInput({ title: "X", contactPreferred: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.contactPreferred).toBe("AUTO");
  });

  it("rejects an invalid contact channel", () => {
    expect(validateRecruitmentAdInput({ title: "X", contactPreferred: "SMS" })).toEqual({
      ok: false,
      error: "INVALID_CONTACT_CHANNEL",
    });
  });

  it("keeps a Discord id only when a pseudo accompanies it", () => {
    const withPseudo = validateRecruitmentAdInput({
      title: "X",
      contactDiscord: "marie",
      contactDiscordId: "123456789012345678",
    });
    expect(withPseudo.ok).toBe(true);
    if (withPseudo.ok) expect(withPseudo.value.contactDiscordId).toBe("123456789012345678");

    // Sans pseudo, l'id seul ne sert à rien : neutralisé.
    const orphan = validateRecruitmentAdInput({ title: "X", contactDiscordId: "123456789012345678" });
    expect(orphan.ok).toBe(true);
    if (orphan.ok) expect(orphan.value.contactDiscordId).toBeNull();
  });

  it("drops a Discord id that is not a snowflake", () => {
    const result = validateRecruitmentAdInput({
      title: "X",
      contactDiscord: "marie",
      contactDiscordId: "not-a-snowflake",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contactDiscordId).toBeNull();
  });
});

describe("shouldShowRecruitmentModal", () => {
  const now = 1_700_000_000_000;

  it("shows the modal when never seen (null timestamp)", () => {
    expect(shouldShowRecruitmentModal(null, now)).toBe(true);
  });

  it("hides the modal when seen just now", () => {
    expect(shouldShowRecruitmentModal(now, now)).toBe(false);
  });

  it("hides the modal within the 7-day window", () => {
    const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
    expect(shouldShowRecruitmentModal(sixDaysAgo, now)).toBe(false);
  });

  it("shows the modal exactly one week after the last view", () => {
    expect(shouldShowRecruitmentModal(now - RECRUITMENT_MODAL_INTERVAL_MS, now)).toBe(true);
  });

  it("shows the modal once the window has fully elapsed", () => {
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    expect(shouldShowRecruitmentModal(eightDaysAgo, now)).toBe(true);
  });

  it("shows the modal when the stored timestamp is invalid (NaN)", () => {
    expect(shouldShowRecruitmentModal(Number.NaN, now)).toBe(true);
  });

  it("shows the modal when the stored timestamp is in the future (skewed clock)", () => {
    expect(shouldShowRecruitmentModal(now + 60_000, now)).toBe(true);
  });

  it("spans exactly seven days", () => {
    expect(RECRUITMENT_MODAL_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
