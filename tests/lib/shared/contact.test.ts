import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_CONTACT,
  validateContactInfo,
  validateDiscordTag,
  validateDiscordUrl,
  validateEmail,
  EMAIL_MAX,
  DISCORD_TAG_MAX,
  SUPERSEDED_CONTACT_EMAILS,
  toPublicContact,
} from "@/lib/shared/contact";
import { ASSOCIATION_EMAIL_ENCODED, decodeContact, encodeContact } from "@/lib/shared/obfuscated-contact";

describe("validateEmail", () => {
  it("accepts and normalises a valid address", () => {
    expect(validateEmail("  Contact@Exemple.INVALID  ")).toEqual({
      ok: true,
      value: "contact@exemple.invalid",
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

  it("le courriel par défaut est celui de l'association, décodé", () => {
    expect(DEFAULT_CONTACT.email).toBe(decodeContact(ASSOCIATION_EMAIL_ENCODED));
    expect(DEFAULT_CONTACT.email.endsWith(["gmail", "com"].join("."))).toBe(true);
  });
});

describe("faux courriel retiré", () => {
  // Composée plutôt qu'écrite : ce fichier ne doit pas être celui qui la publie.
  const FAKE = ["presse", "bluegenji-esport.fr"].join("@");

  it("n'est plus le défaut, et le rattrapage de démarrage le connaît", () => {
    expect(DEFAULT_CONTACT.email).not.toBe(FAKE);
    expect(SUPERSEDED_CONTACT_EMAILS).toEqual([FAKE]);
  });
});

describe("toPublicContact", () => {
  it("encode le courriel et laisse les canaux Discord tels quels", () => {
    const contact = { email: "a@b.invalid", discordTag: "tag", discordUrl: "https://discord.gg/x" };
    const pub = toPublicContact(contact);
    expect(pub).toEqual({ emailEncoded: encodeContact("a@b.invalid"), discordTag: "tag", discordUrl: "https://discord.gg/x" });
    expect(JSON.stringify(pub)).not.toContain("a@b.invalid");
    expect(decodeContact(pub.emailEncoded)).toBe("a@b.invalid");
  });

  it("un courriel vide reste vide", () => {
    expect(toPublicContact({ email: "", discordTag: "", discordUrl: "" }).emailEncoded).toBe("");
  });
});
