import { describe, expect, it } from "@jest/globals";
import { profileErrorMessage } from "@/app/(secured)/profil/profile-errors";
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
});
