import { describe, expect, it } from "@jest/globals";
import { parseEmphasis, stripEmphasis } from "@/lib/shared/inline-emphasis";
import { COMMON_RULES, TOURNAMENT_RULE_MODES } from "@/lib/shared/tournament-rules";

describe("parseEmphasis", () => {
  it("rend un texte sans marque en un seul segment", () => {
    expect(parseEmphasis("Trois manches à gagner.")).toEqual([
      { text: "Trois manches à gagner.", bold: false },
    ]);
  });

  it("découpe autour d'une marque", () => {
    expect(parseEmphasis("La finale se joue en **un seul match** ici.")).toEqual([
      { text: "La finale se joue en ", bold: false },
      { text: "un seul match", bold: true },
      { text: " ici.", bold: false },
    ]);
  });

  it("gère plusieurs marques dans la même phrase", () => {
    expect(parseEmphasis("**Un**, puis **deux**")).toEqual([
      { text: "Un", bold: true },
      { text: ", puis ", bold: false },
      { text: "deux", bold: true },
    ]);
  });

  it("accepte une marque en tête et en fin de texte", () => {
    expect(parseEmphasis("**Nombre fixe**")).toEqual([{ text: "Nombre fixe", bold: true }]);
  });

  // Mieux vaut afficher l'astérisque d'une faute de frappe que d'avaler la fin
  // du paragraphe.
  it("laisse littérale une marque non refermée", () => {
    expect(parseEmphasis("un **début sans fin")).toEqual([
      { text: "un **début sans fin", bold: false },
    ]);
  });

  it("laisse littérale une marque vide", () => {
    expect(parseEmphasis("a ****b")).toEqual([{ text: "a ****b", bold: false }]);
  });

  it("n'émet jamais de segment vide", () => {
    for (const segment of parseEmphasis("**a****b**")) {
      expect(segment.text.length).toBeGreaterThan(0);
    }
  });

  it("chaîne vide → aucun segment", () => {
    expect(parseEmphasis("")).toEqual([]);
  });

  it("conserve le texte à la lettre près", () => {
    const source = "La **cadence** est fixée à la création, en **deux** réglages.";
    expect(stripEmphasis(source)).toBe(
      "La cadence est fixée à la création, en deux réglages.",
    );
  });
});

/**
 * L'ancre : le registre des règles emploie bien la marque, et c'est ce qui
 * justifie de la rendre. Si l'emphase en disparaissait un jour, ce test le
 * dirait avant que le module ne devienne du code mort.
 */
describe("registre des règles", () => {
  const texts = [
    ...COMMON_RULES,
    ...TOURNAMENT_RULE_MODES.flatMap((mode) => mode.sections),
  ].flatMap((rule) => [...rule.body, ...(rule.bullets ?? [])]);

  it("contient des passages en gras", () => {
    expect(texts.some((text) => parseEmphasis(text).some((s) => s.bold))).toBe(true);
  });

  it("n'y laisse aucune marque orpheline", () => {
    for (const text of texts) {
      expect(stripEmphasis(text)).not.toContain("**");
    }
  });
});
