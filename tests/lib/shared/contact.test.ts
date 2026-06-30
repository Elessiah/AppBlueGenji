import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_CONTACT,
  validateContactInfo,
  validateDiscordTag,
  validateDiscordUrl,
  validateEmail,
  EMAIL_MAX,
  DISCORD_TAG_MAX,
} from "@/lib/shared/contact";

describe("validateEmail", () => {
  it("accepts and normalises a valid address", () => {
    expect(validateEmail("  Presse@BlueGenji-Esport.FR  ")).toEqual({
      ok: true,
      value: "presse@bluegenji-esport.fr",
    });
  });

  it("treats empty as valid (optional channel)", () => {
    expect(validateEmail("")).toEqual({ ok: true, value: "" });
    expect(validateEmail("   ")).toEqual({ ok: true, value: "" });
    expect(validateEmail(null)).toEqual({ ok: true, value: "" });
  });

  it.each(["plainaddress", "no@domain", "@no-local.fr", "spaces in@mail.fr", "two@@at.fr"])(
    "rejects malformed address %s",
    (bad) => {
      expect(validateEmail(bad)).toEqual({ ok: false, error: "EMAIL_INVALID" });
    },
  );

  it("rejects an over-long address", () => {
    expect(validateEmail(`${"a".repeat(EMAIL_MAX)}@x.fr`)).toEqual({ ok: false, error: "EMAIL_TOO_LONG" });
  });
});

describe("validateDiscordTag", () => {
  it("accepts a trimmed tag", () => {
    expect(validateDiscordTag("  bluegenji ")).toEqual({ ok: true, value: "bluegenji" });
  });

  it("treats empty as valid", () => {
    expect(validateDiscordTag("")).toEqual({ ok: true, value: "" });
  });

  it("rejects a tag with whitespace", () => {
    expect(validateDiscordTag("blue genji")).toEqual({ ok: false, error: "DISCORD_TAG_INVALID" });
  });

  it("rejects an over-long tag", () => {
    expect(validateDiscordTag("a".repeat(DISCORD_TAG_MAX + 1))).toEqual({
      ok: false,
      error: "DISCORD_TAG_TOO_LONG",
    });
  });
});

describe("validateDiscordUrl", () => {
  it.each([
    "https://discord.gg/bluegenji",
    "https://discord.com/invite/abcd",
    "http://discordapp.com/x",
  ])("accepts a Discord link %s", (url) => {
    expect(validateDiscordUrl(url).ok).toBe(true);
  });

  it("treats empty as valid", () => {
    expect(validateDiscordUrl("")).toEqual({ ok: true, value: "" });
  });

  it.each(["https://evil.com/discord", "not a url", "ftp://discord.gg/x", "discord.gg/x"])(
    "rejects non-Discord or malformed link %s",
    (bad) => {
      expect(validateDiscordUrl(bad)).toEqual({ ok: false, error: "DISCORD_URL_INVALID" });
    },
  );
});

describe("validateContactInfo", () => {
  it("normalises all three channels", () => {
    expect(
      validateContactInfo({
        email: "  A@B.FR ",
        discordTag: " tag ",
        discordUrl: "https://discord.gg/x",
      }),
    ).toEqual({
      ok: true,
      value: { email: "a@b.fr", discordTag: "tag", discordUrl: "https://discord.gg/x" },
    });
  });

  it("allows an all-empty payload", () => {
    expect(validateContactInfo({ email: "", discordTag: "", discordUrl: "" })).toEqual({
      ok: true,
      value: { email: "", discordTag: "", discordUrl: "" },
    });
  });

  it("surfaces the first failing field", () => {
    expect(validateContactInfo({ email: "bad", discordUrl: "https://discord.gg/x" })).toEqual({
      ok: false,
      error: "EMAIL_INVALID",
    });
  });

  it("ships sensible defaults", () => {
    expect(validateContactInfo(DEFAULT_CONTACT).ok).toBe(true);
  });
});
