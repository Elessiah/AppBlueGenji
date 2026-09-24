import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { displayedNumber, parseNumberDraft, valueAfterEdit } from "@/lib/shared/number-draft";
import { stripLineComments } from "../../helpers/strip-comments";

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

describe("valueAfterEdit", () => {
  it("rétablit la valeur d'avant l'édition quand le champ est quitté vide", () => {
    // « 16 » vidé au Retour arrière passe par « 1 » : on ne le garde pas.
    expect(valueAfterEdit("", 1, 16)).toBe(16);
    expect(valueAfterEdit("-", 1, 16)).toBe(16);
  });

  it("garde la dernière valeur lue quand le champ porte un nombre", () => {
    expect(valueAfterEdit("32", 32, 16)).toBe(32);
    expect(valueAfterEdit("0", 0, 16)).toBe(0);
  });

  it("ne change rien hors édition", () => {
    expect(valueAfterEdit(null, 9, 16)).toBe(9);
  });
});

describe("stripLineComments", () => {
  it("ne coupe pas dans une chaîne qui contient « /* »", () => {
    const source = ['const a = "image/*";', "const sql = `FOR SHARE`;", "/** doc */", ""].join("\n");
    expect(stripLineComments(source)).toContain("FOR SHARE");
  });

  it("retire les commentaires qui ouvrent une ligne", () => {
    const source = ["// FOR SHARE", "  /* FOR SHARE */", "{/* FOR SHARE */}", "code();"].join("\n");
    expect(stripLineComments(source)).not.toContain("FOR SHARE");
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
        /(?<!\? )Number\((e|event)\.target\.value\)/.test(stripLineComments(readFileSync(path, "utf8"))),
      )
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});
