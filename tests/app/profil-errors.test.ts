import { describe, expect, it } from "@jest/globals";
import {
  profileErrorMessage,
  profileLoadErrorMessage,
} from "@/app/(secured)/profil/profile-errors";
import { discordVerificationErrorMessage } from "@/app/(secured)/profil/discord-errors";

/**
 * Le registre de la **sauvegarde du profil**, distinct de celui de la
 * certification.
 *
 * Router les erreurs du profil vers l'autre faisait annoncer « La certification
 * a échoué » à un pseudo déjà pris, à une coupure réseau, à tout ce qui n'était
 * pas prévu. Un repli ne doit jamais affirmer une cause qu'il ne connaît pas.
 */
describe("profileErrorMessage", () => {
  it("traduit le refus du tag verrouillé", () => {
    const message = profileErrorMessage("DISCORD_TAG_LOCKED");
    expect(message).toContain("rattaché");
    expect(message).toContain("retire-le");
  });

  it("traduit le pseudo déjà pris sans parler de Discord", () => {
    const message = profileErrorMessage("PSEUDO_ALREADY_USED");
    expect(message).toContain("pseudo");
    expect(message).not.toMatch(/discord/i);
  });

  it("reste vague sur un code inconnu plutôt que d'inventer une cause", () => {
    const message = profileErrorMessage("ER_LOCK_DEADLOCK");
    expect(message).toBe("La sauvegarde a échoué. Réessaie dans un instant.");
    expect(message).not.toMatch(/certification/i);
  });

  it("ne laisse jamais sortir le code brut", () => {
    for (const code of ["ER_LOCK_DEADLOCK", "BOOM", null, undefined, ""]) {
      expect(profileErrorMessage(code)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });

  it("ne recouvre pas le registre de la certification", () => {
    // Deux écrans, deux consignes : le repli de l'un ne doit pas servir l'autre.
    expect(profileErrorMessage("BOOM")).not.toBe(discordVerificationErrorMessage("BOOM"));
  });

  it("est le **seul** registre à connaître le verrou du tag", () => {
    // `DISCORD_TAG_LOCKED` ne sort que de `PATCH /api/profile` ; le dialogue de
    // certification ne parle qu'à `/api/profile/discord`. Une seconde entrée
    // serait morte, et figerait une copie de la phrase que le premier
    // ajustement ferait diverger.
    expect(discordVerificationErrorMessage("DISCORD_TAG_LOCKED")).toBe(
      discordVerificationErrorMessage("BOOM"),
    );
  });

  it("traduit un tag d'un type inattendu sans laisser sortir de TypeError", () => {
    // Le corps du `PATCH` n'est qu'annoté : `{"discordPseudo": 123}` faisait
    // lever `.trim()`, et le message interne du `TypeError` ressortait dans le
    // corps du 400.
    expect(profileErrorMessage("INVALID_DISCORD_PSEUDO")).toContain("tag Discord");
  });
});

describe("profileLoadErrorMessage", () => {
  /**
   * Le même registre, avec le repli d'une **lecture**. « La sauvegarde a
   * échoué » annonçait à un visiteur qui vient d'ouvrir la page l'échec d'un
   * geste qu'il n'a pas fait.
   */
  it("ne parle pas de sauvegarde sur un code inconnu", () => {
    const message = profileLoadErrorMessage("ER_LOCK_DEADLOCK");
    expect(message).not.toMatch(/sauvegarde/i);
    expect(message).toMatch(/charger/i);
  });

  it("partage les codes nommés avec les écritures — les dupliquer les ferait diverger", () => {
    for (const code of ["UNAUTHORIZED", "PROFILE_NOT_FOUND"]) {
      expect(profileLoadErrorMessage(code)).toBe(profileErrorMessage(code));
    }
  });

  it("ne laisse jamais sortir le code brut", () => {
    for (const code of ["ER_LOCK_DEADLOCK", "BOOM", null, undefined, ""]) {
      expect(profileLoadErrorMessage(code)).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
    }
  });
});
