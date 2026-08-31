import { describe, expect, it } from "@jest/globals";
import { isDeletionConfirmed } from "@/lib/shared/tournament-deletion";

describe("isDeletionConfirmed", () => {
  it("arme la suppression sur une recopie exacte", () => {
    expect(isDeletionConfirmed("BlueGenji Open #3", "BlueGenji Open #3")).toBe(true);
  });

  it("tolère les espaces autour de la saisie", () => {
    expect(isDeletionConfirmed("BlueGenji Open", "  BlueGenji Open  ")).toBe(true);
  });

  it("tolère un repli des espaces internes", () => {
    // Un nom recopié depuis le titre de la page a déjà subi ce repli au rendu HTML.
    expect(isDeletionConfirmed("BlueGenji   Open", "BlueGenji Open")).toBe(true);
    expect(isDeletionConfirmed("BlueGenji Open", "BlueGenji \n\t Open")).toBe(true);
  });

  it("exige la même casse", () => {
    expect(isDeletionConfirmed("BlueGenji Open", "bluegenji open")).toBe(false);
  });

  it("exige les mêmes accents", () => {
    expect(isDeletionConfirmed("Coupe d'Été", "Coupe d'Ete")).toBe(false);
  });

  it.each([
    ["saisie vide", "BlueGenji Open", ""],
    ["saisie blanche", "BlueGenji Open", "   "],
    ["nom tronqué", "BlueGenji Open", "BlueGenji"],
    ["nom rallongé", "BlueGenji Open", "BlueGenji Open 2"],
    ["autre tournoi", "BlueGenji Open", "Marvel Rivals Cup"],
  ])("refuse : %s", (_label, name, input) => {
    expect(isDeletionConfirmed(name, input)).toBe(false);
  });

  it("ne confirme jamais un tournoi au nom vide, même avec une saisie vide", () => {
    // Sans ce garde-fou, un champ laissé vide armerait le bouton.
    expect(isDeletionConfirmed("", "")).toBe(false);
    expect(isDeletionConfirmed("   ", "   ")).toBe(false);
  });
});
