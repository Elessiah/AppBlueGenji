import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { displayedNumber, parseNumberDraft } from "@/lib/shared/number-draft";

describe("parseNumberDraft", () => {
  it("lit un nombre", () => {
    expect(parseNumberDraft("12")).toBe(12);
    expect(parseNumberDraft(" 7 ")).toBe(7);
    expect(parseNumberDraft("0")).toBe(0);
    expect(parseNumberDraft("-3")).toBe(-3);
    expect(parseNumberDraft("2.5")).toBe(2.5);
  });

  it("ne lit pas un champ vidé comme zéro", () => {
    // Le défaut d'origine : `Number("")` vaut 0, et le Retour arrière
    // réécrivait un « 0 » dans le champ qu'on venait de vider.
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("   ")).toBeNull();
  });

  it("ne lit rien dans une saisie partielle ou illisible", () => {
    expect(parseNumberDraft("-")).toBeNull();
    expect(parseNumberDraft("abc")).toBeNull();
    expect(parseNumberDraft("Infinity")).toBeNull();
  });
});

describe("displayedNumber", () => {
  it("montre la saisie en cours, même vide", () => {
    expect(displayedNumber("", 9)).toBe("");
    expect(displayedNumber("1", 9)).toBe("1");
  });

  it("montre la valeur retenue hors édition", () => {
    expect(displayedNumber(null, 9)).toBe("9");
    expect(displayedNumber(null, 0)).toBe("0");
  });

  it("rend un champ vide pour une valeur absente ou illisible", () => {
    expect(displayedNumber(null, null)).toBe("");
    expect(displayedNumber(null, undefined)).toBe("");
    expect(displayedNumber(null, Number.NaN)).toBe("");
  });
});

describe("champs numériques des formulaires", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  it("ne convertissent jamais le texte brut en nombre à chaque frappe", () => {
    // `value={n} onChange={(e) => set(Number(e.target.value))}` empêche de
    // vider le champ : passer par `<NumberInput>` (`components/ui/number-input.tsx`).
    // Un champ facultatif qui garde le vide (`e.target.value ? Number(…) : null`)
    // n'est pas concerné.
    const offenders = ["app", "components"]
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((path) => path.endsWith(".tsx"))
      .filter((path) =>
        /(?<!\? )Number\((e|event)\.target\.value\)/.test(
          // Sans les commentaires, qui peuvent citer le motif pour l'expliquer.
          readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
        ),
      )
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
