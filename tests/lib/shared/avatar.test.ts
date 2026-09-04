import { describe, expect, it } from "@jest/globals";
import { avatarInitial } from "@/lib/shared/avatar";

/**
 * L'initiale est le **seul** repli d'avatar du site : il n'existe pas de
 * fichier par défaut dans `public/`. Elle doit donc rendre quelque chose pour
 * n'importe quel pseudo, y compris ceux que le formulaire ne produit pas —
 * compte anonymisé, pseudo réduit à des espaces.
 */
describe("avatarInitial", () => {
  it("rend la première lettre en majuscule", () => {
    expect(avatarInitial("nova")).toBe("N");
    expect(avatarInitial("Nova")).toBe("N");
  });

  it("ignore les espaces de tête", () => {
    expect(avatarInitial("  nova")).toBe("N");
  });

  it("retombe sur « ? » quand il n'y a rien à afficher", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
    expect(avatarInitial(undefined)).toBe("?");
  });

  // `pseudo[0]` coupait au milieu d'une paire de substitution UTF-16 et rendait
  // un caractère de remplacement.
  it("compte en caractères, pas en unités UTF-16", () => {
    expect(avatarInitial("🐉Dragons")).toBe("🐉");
  });

  it("laisse tel quel ce qui n'a pas de majuscule", () => {
    expect(avatarInitial("42e régiment")).toBe("4");
  });
});
