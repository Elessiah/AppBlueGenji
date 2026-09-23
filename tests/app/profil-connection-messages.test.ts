import { describe, expect, it } from "@jest/globals";
import { connectionSuccessMessage } from "@/app/(secured)/profil/connection-errors";

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
