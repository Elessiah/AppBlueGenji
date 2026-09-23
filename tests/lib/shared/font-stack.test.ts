import { describe, expect, it } from "@jest/globals";
import { fontStack, type LoadedFont } from "@/lib/shared/font-stack";

const face = (fontFamily: string): LoadedFont => ({ style: { fontFamily } });

describe("fontStack", () => {
  it("énumère tous les sous-ensembles avant le moindre repli", () => {
    // Arial (base du repli ajusté) a les glyphes latin-ext : placé entre le
    // latin et le latin-ext, il servirait le `Ł` avant la police qui l'a.
    const stack = fontStack([
      face("'__interLatin_a1', '__interLatin_Fallback_a1'"),
      face("'__interLatinExt_b2'"),
      face("'__interCyrillic_c3'"),
    ]);
    expect(stack).toBe("'__interLatin_a1', '__interLatinExt_b2', '__interCyrillic_c3', '__interLatin_Fallback_a1'");
  });

  it("rend telle quelle la pile d'une police sans découpage", () => {
    expect(fontStack([face("'orbitronLatin', 'orbitronLatin Fallback'")])).toBe(
      "'orbitronLatin', 'orbitronLatin Fallback'",
    );
  });

  it("tolère une police sans repli ajusté", () => {
    expect(fontStack([face("'a'"), face("'b'")])).toBe("'a', 'b'");
  });

  it("ne répète pas un repli partagé", () => {
    expect(fontStack([face("'a', sans-serif"), face("'b', sans-serif")])).toBe("'a', 'b', sans-serif");
  });

  it("refuse une pile vide plutôt que de rendre une variable CSS vide", () => {
    // `--font-sans:` vide rendrait toute déclaration qui l'emploie invalide au
    // calcul — la police retomberait sur celle du parent, sans erreur.
    expect(() => fontStack([])).toThrow();
  });
});
