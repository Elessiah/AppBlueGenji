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
  it("dit qui lit un tag certifié, plutôt que d'où il vient", () => {
    const notice = discordTagLockNotice({ tag: "keryan", verified: true });
    expect(notice).toContain("rattaché");
    expect(notice).toContain("certifié");
    expect(notice).toContain("administrateurs");
  });

  it("n'annonce pas une certification que le compte n'a pas", () => {
    // Le rattachement ne la garantit pas : `linkOAuthIdentity` n'écrit le
    // pseudo que si Discord en donne un affichable, si bien qu'un compte lié
    // peut porter un tag saisi à la main. L'annoncer certifié contredirait la
    // pastille absente d'à côté.
    const notice = discordTagLockNotice({ tag: "keryan", verified: false });
    expect(notice).toContain("n'est pas certifié");
    expect(notice).toContain("personne ne le voit");
  });

  it("n'affirme jamais l'origine du tag — elle n'est pas garantie", () => {
    for (const verified of [true, false]) {
      expect(discordTagLockNotice({ tag: "keryan", verified })).not.toContain("vient de Discord");
    }
  });

  it("dit l'état et le geste sans inventer la cause d'un champ vide", () => {
    // Deux causes y mènent — un tag retiré, ou un pseudo Discord numérique —
    // et l'écran ne peut pas les distinguer : le joueur qui vient de retirer
    // son tag n'a pas à lire une explication fausse.
    const notice = discordTagLockNotice({ tag: null, verified: false });
    expect(notice).toContain("aucun pseudo n'est enregistré");
    expect(notice).not.toContain("numérique");
    expect(notice).not.toContain("est certifié");
  });

  it("ne nomme que des gestes qui existent à l'écran", () => {
    // « Détache Discord » n'en est pas un pour un compte né par Discord : le
    // bouton y est remplacé par le refus `LAST_CONNECTION`, faute d'une autre
    // porte. Le nommer enverrait chercher un contrôle absent.
    const notices = [
      discordTagLockNotice({ tag: "keryan", verified: true }),
      discordTagLockNotice({ tag: "keryan", verified: false }),
      discordTagLockNotice({ tag: null, verified: false }),
    ];
    for (const notice of notices) {
      expect(notice.toLowerCase()).toContain("reconnecte-toi");
      expect(notice).not.toContain("Applications connectées");
    }
  });

  it("nomme le retrait, seul geste d'annulation, dès qu'un tag est enregistré", () => {
    for (const verified of [true, false]) {
      expect(discordTagLockNotice({ tag: "keryan", verified })).toContain("retire-le");
    }
  });
});

describe("DISCORD_TAG_LOCKED", () => {
  it("est le code que la route rend en 409", () => {
    expect(DISCORD_TAG_LOCKED).toBe("DISCORD_TAG_LOCKED");
  });
});
