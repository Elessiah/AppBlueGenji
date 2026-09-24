import { describe, expect, it } from "@jest/globals";
import { isNavLinkActive } from "@/lib/shared/nav-active";

describe("isNavLinkActive", () => {
  it("désigne la section sur sa propre page", () => {
    expect(isNavLinkActive("/equipes", "/equipes")).toBe(true);
  });

  it("la désigne encore sur ses sous-pages", () => {
    expect(isNavLinkActive("/equipes/12", "/equipes")).toBe(true);
    expect(isNavLinkActive("/tournois/4/modifier", "/tournois")).toBe(true);
  });

  it("ne confond pas une page qui commence seulement pareil", () => {
    expect(isNavLinkActive("/equipes-archive", "/equipes")).toBe(false);
    expect(isNavLinkActive("/joueur", "/joueurs")).toBe(false);
  });

  it("ne désigne pas une autre section", () => {
    expect(isNavLinkActive("/joueurs", "/equipes")).toBe(false);
  });

  it("ne désigne jamais un lien vers une ancre de l'accueil", () => {
    expect(isNavLinkActive("/", "/#tournois")).toBe(false);
    expect(isNavLinkActive("/tournois", "/#tournois")).toBe(false);
  });

  it("ne rend l'accueil actif que sur l'accueil, pas sur toutes les pages", () => {
    expect(isNavLinkActive("/", "/")).toBe(true);
    expect(isNavLinkActive("/regles", "/")).toBe(false);
  });

  it("ignore un lien externe ou relatif", () => {
    expect(isNavLinkActive("/bot", "https://exemple.invalid/bot")).toBe(false);
    expect(isNavLinkActive("/bot", "bot")).toBe(false);
  });

  it("ne désigne rien quand le chemin courant est inconnu", () => {
    expect(isNavLinkActive(null, "/equipes")).toBe(false);
    expect(isNavLinkActive(undefined, "/equipes")).toBe(false);
    expect(isNavLinkActive("", "/equipes")).toBe(false);
  });
});
