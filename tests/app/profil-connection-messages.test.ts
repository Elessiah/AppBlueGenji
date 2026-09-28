import { describe, expect, it } from "@jest/globals";
import {
  connectionSuccessMessage,
  otherSessionsSummary,
  sessionsRevokedMessage,
  unlinkSuccessMessage,
} from "@/app/(secured)/profil/connection-errors";

/**
 * Le retour réussi d'un aller-retour de rattachement couvre deux gestes :
 * **ajouter** une application, et **reconfirmer** celle qui l'était déjà — le
 * chemin par lequel un compte relié à Discord certifie son tag.
 */
describe("connectionSuccessMessage", () => {
  it("annonce un rattachement quand l'application est neuve", () => {
    expect(connectionSuccessMessage("GOOGLE", false)).toBe(
      "Google est maintenant rattaché à ton compte.",
    );
  });

  it("n'annonce pas un rattachement à qui l'était déjà", () => {
    const message = connectionSuccessMessage("DISCORD", true);
    expect(message).not.toMatch(/maintenant rattaché/);
    expect(message).toMatch(/pseudo/);
  });

  it("reste juste pour les autres fournisseurs reconfirmés", () => {
    expect(connectionSuccessMessage("BLIZZARD", true)).toMatch(/reconfirmé/);
  });

  it("garde une phrase quand le fournisseur est illisible", () => {
    expect(connectionSuccessMessage(null, false)).toBe("Application rattachée.");
    expect(connectionSuccessMessage(null, true)).toBe("Application reconfirmée.");
  });
});

describe("sessions ouvertes", () => {
  it("dit le nombre d'autres sessions, accord compris, sans l'inventer", () => {
    expect(otherSessionsSummary(null)).toMatch(/pas encore été comptées/);
    expect(otherSessionsSummary(0)).toMatch(/Aucune autre session/);
    expect(otherSessionsSummary(1)).toBe("1 autre session est ouverte sur d'autres navigateurs ou appareils.");
    expect(otherSessionsSummary(3)).toBe("3 autres sessions sont ouvertes sur d'autres navigateurs ou appareils.");
  });

  it("rend compte de la fermeture", () => {
    expect(sessionsRevokedMessage(0)).toBe("Aucune autre session n'était ouverte.");
    expect(sessionsRevokedMessage(1)).toBe("1 autre session a été fermée.");
    expect(sessionsRevokedMessage(2)).toBe("2 autres sessions ont été fermées.");
  });

  it("annonce le retrait d'une porte avec les sessions qu'il a fermées", () => {
    expect(unlinkSuccessMessage("GOOGLE", 0)).toBe("Google a été retiré de ton compte.");
    expect(unlinkSuccessMessage("GOOGLE", 2)).toBe("Google a été retiré de ton compte. 2 autres sessions ont été fermées.");
  });

  it("ne tait pas l'échec de la fermeture, et renvoie au bouton", () => {
    const message = unlinkSuccessMessage("DISCORD", null);
    expect(message).toMatch(/^Discord a été retiré de ton compte\./);
    expect(message).toMatch(/Déconnecter mes autres sessions/);
  });
});
