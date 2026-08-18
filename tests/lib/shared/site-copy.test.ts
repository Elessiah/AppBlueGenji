import { describe, expect, it } from "@jest/globals";
import {
  defaultSiteCopy,
  isSiteCopyKey,
  siteCopyField,
  siteCopySettingKey,
  SITE_COPY_FIELDS,
  validateSiteCopy,
} from "@/lib/shared/site-copy";

describe("registre des textes éditables", () => {
  it("n'expose que des clés uniques", () => {
    const keys = SITE_COPY_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fournit un texte par défaut non vide pour chaque entrée", () => {
    for (const field of SITE_COPY_FIELDS) {
      expect(field.defaultValue.trim().length).toBeGreaterThan(0);
      // Un défaut plus long que la limite serait irrécupérable à l'édition.
      expect(field.defaultValue.length).toBeLessThanOrEqual(field.maxLength);
    }
  });

  it("reconnaît ses clés et rejette les autres", () => {
    expect(isSiteCopyKey("home.hero.title")).toBe(true);
    expect(isSiteCopyKey("home.inconnu")).toBe(false);
    expect(isSiteCopyKey(42)).toBe(false);
    expect(siteCopyField("home.inconnu")).toBeUndefined();
  });

  it("préfixe les clés de stockage pour ne pas heurter les autres réglages", () => {
    expect(siteCopySettingKey("home.hero.title")).toBe("copy_home.hero.title");
  });

  it("construit un jeu complet de valeurs par défaut", () => {
    const defaults = defaultSiteCopy();
    expect(Object.keys(defaults)).toHaveLength(SITE_COPY_FIELDS.length);
    expect(defaults["home.hero.eyebrow"]).toBe("ASSOCIATION ESPORT · LOI 1901");
  });
});

describe("validateSiteCopy", () => {
  it("accepte et normalise un texte valide", () => {
    const result = validateSiteCopy("home.hero.title", "  Ligne 1\r\nLigne 2  ");
    expect(result).toEqual({ ok: true, value: "Ligne 1\nLigne 2" });
  });

  it("refuse une clé inconnue", () => {
    expect(validateSiteCopy("nope", "x")).toEqual({ ok: false, error: "UNKNOWN_COPY_KEY" });
  });

  it.each([["", "vide"], ["   ", "espaces"], [null, "null"], [undefined, "undefined"]])(
    "refuse un texte %p (%s)",
    (value) => {
      expect(validateSiteCopy("home.hero.title", value)).toEqual({
        ok: false,
        error: "COPY_EMPTY",
      });
    },
  );

  it("refuse un texte plus long que la limite du champ", () => {
    const field = siteCopyField("home.hero.eyebrow")!;
    expect(validateSiteCopy(field.key, "x".repeat(field.maxLength + 1))).toEqual({
      ok: false,
      error: "COPY_TOO_LONG",
    });
    expect(validateSiteCopy(field.key, "x".repeat(field.maxLength)).ok).toBe(true);
  });
});
