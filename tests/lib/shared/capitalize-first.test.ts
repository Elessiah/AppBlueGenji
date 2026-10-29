import { describe, expect, it } from "@jest/globals";
import { capitalizeFirst } from "@/lib/shared/capitalize-first";

describe("capitalizeFirst", () => {
  it("met la première lettre en capitale et laisse le reste", () => {
    expect(capitalizeFirst("premier à 3 manches gagnées")).toBe("Premier à 3 manches gagnées");
    expect(capitalizeFirst("first to 3 maps won")).toBe("First to 3 maps won");
  });

  it("laisse une chaîne vide ou déjà capitalisée", () => {
    expect(capitalizeFirst("")).toBe("");
    expect(capitalizeFirst("Déjà")).toBe("Déjà");
  });

  it("gère une initiale accentuée et un caractère hors du plan de base", () => {
    expect(capitalizeFirst("élimination directe")).toBe("Élimination directe");
    expect(capitalizeFirst("\u{10428}x")).toBe("\u{10400}x");
  });

  it("applique la casse de la langue demandée", () => {
    expect(capitalizeFirst("iyi", "tr")).toBe("İyi");
  });
});
