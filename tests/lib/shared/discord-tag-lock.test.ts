import { describe, expect, it } from "@jest/globals";
import {
  DISCORD_TAG_LOCKED,
  checkDiscordTagEdit,
  discordTagLockNotice,
  isDiscordTagLocked,
} from "@/lib/shared/discord-tag-lock";

describe("checkDiscordTagEdit", () => {
  it("laisse saisir tant qu'aucun compte Discord n'est rattaché", () => {
    expect(checkDiscordTagEdit({ linked: false })).toBeNull();
    expect(isDiscordTagLocked({ linked: false })).toBe(false);
  });

  it("refuse la saisie dès qu'un compte Discord est rattaché", () => {
    expect(checkDiscordTagEdit({ linked: true })).toBe("LINKED_ACCOUNT");
    expect(isDiscordTagLocked({ linked: true })).toBe(true);
  });

  it("ne décide que sur le rattachement — ni le tag ni la certification", () => {
    // Un compte rattaché sans tag affichable reste verrouillé : ce qu'il
    // saisirait ne serait de toute façon pas certifiable.
    expect(isDiscordTagLocked({ linked: true })).toBe(true);
  });
});

describe("discordTagLockNotice", () => {
  it("dit d'où vient le tag et qu'il est certifié", () => {
    const notice = discordTagLockNotice("keryan");
    expect(notice).toContain("rattaché");
    expect(notice).toContain("certifié");
  });

  it("explique l'absence de tag plutôt que de laisser un champ vide sans raison", () => {
    const notice = discordTagLockNotice(null);
    expect(notice).toContain("aucun pseudo affichable");
    expect(notice).not.toContain("est certifié");
  });

  it("nomme toujours les deux gestes qui rouvrent la donnée", () => {
    for (const notice of [discordTagLockNotice("keryan"), discordTagLockNotice(null)]) {
      expect(notice).toContain("reconnecte-toi");
      expect(notice).toContain("Applications connectées");
    }
  });
});

describe("DISCORD_TAG_LOCKED", () => {
  it("est le code que la route rend en 409", () => {
    expect(DISCORD_TAG_LOCKED).toBe("DISCORD_TAG_LOCKED");
  });
});
