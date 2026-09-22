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
    const notice = discordTagLockNotice({ tag: "keryan", verified: true });
    expect(notice).toContain("rattaché");
    expect(notice).toContain("et est certifié");
  });

  it("n'annonce pas une certification que le compte n'a pas", () => {
    // Le rattachement ne la garantit pas : un tag modifié à la main avant cette
    // règle laisse un compte lié mais non certifié. L'annoncer certifié
    // contredirait la pastille absente d'à côté — et promettrait au joueur que
    // l'organisation peut le joindre, ce qu'elle ne peut pas.
    const notice = discordTagLockNotice({ tag: "keryan", verified: false });
    expect(notice).toContain("n'est pas certifié");
    expect(notice).toContain("personne ne le voit");
  });

  it("explique l'absence de tag plutôt que de laisser un champ vide sans raison", () => {
    const notice = discordTagLockNotice({ tag: null, verified: false });
    expect(notice).toContain("aucun pseudo affichable");
    expect(notice).not.toContain("est certifié");
  });

  it("nomme toujours les deux gestes qui rouvrent la donnée", () => {
    const notices = [
      discordTagLockNotice({ tag: "keryan", verified: true }),
      discordTagLockNotice({ tag: "keryan", verified: false }),
      discordTagLockNotice({ tag: null, verified: false }),
    ];
    for (const notice of notices) {
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
