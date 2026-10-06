import { describe, expect, it } from "@jest/globals";
import {
  SITE_COPY_ERROR_MESSAGES,
  SITE_COPY_FIELD_ERRORS,
  SITE_COPY_FIELDS,
  defaultSiteCopy,
  resolveSiteCopy,
  siteCopyErrorMessage,
  siteCopySettingKey,
  siteCopySettingKeys,
  validateBilingualSiteCopy,
} from "@/lib/shared/site-copy";

/** Colonne `bg_settings.setting_key` (`lib/server/database/schema/showcase.ts`). */
const SETTING_KEY_MAX = 80;

describe("textes éditables — anglais d'origine", () => {
  it("chaque texte a son anglais, non vide, sous le même plafond que le français", () => {
    for (const field of SITE_COPY_FIELDS) {
      expect({ key: field.key, ok: field.defaultValueEn.trim().length > 0 }).toEqual({ key: field.key, ok: true });
      expect(field.defaultValueEn.length).toBeLessThanOrEqual(field.maxLength);
      expect(field.defaultValueEn).not.toBe(field.defaultValue);
      // Un anglais d'origine n'a ni accent français ni guillemets à la française.
      expect(field.defaultValueEn).not.toMatch(/[àâçéèêëîïôûùœ«»]/i);
    }
  });

  it("garde les mêmes retours à la ligne qu'en français (titres multilignes)", () => {
    for (const field of SITE_COPY_FIELDS) {
      expect(field.defaultValueEn.split("\n")).toHaveLength(field.defaultValue.split("\n").length);
    }
  });

  it("couvre les clés de l'accueil, de l'association et du classement", () => {
    const keys = SITE_COPY_FIELDS.map((field) => field.key);
    expect(keys).toEqual(expect.arrayContaining(["home.hero.title", "association.hero.title", "ranking.hero.title", "ranking.hero.lede"]));
    expect(defaultSiteCopy("en")["ranking.hero.title"]).toBe("Climb all the way\nto the top.");
  });
});

describe("textes éditables — stockage par langue", () => {
  it("français inchangé (`copy_<clé>`), anglais à côté (`copy_<clé>__en`)", () => {
    expect(siteCopySettingKey("home.hero.title")).toBe("copy_home.hero.title");
    expect(siteCopySettingKey("home.hero.title", "fr")).toBe("copy_home.hero.title");
    expect(siteCopySettingKey("home.hero.title", "en")).toBe("copy_home.hero.title__en");
  });

  it("toutes les clés tiennent dans la colonne de `bg_settings`", () => {
    const keys = siteCopySettingKeys();
    expect(keys).toHaveLength(SITE_COPY_FIELDS.length * 2);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(SETTING_KEY_MAX);
  });
});

describe("validateBilingualSiteCopy", () => {
  it("accepte et normalise les deux langues", () => {
    expect(validateBilingualSiteCopy("home.hero.title", " A\r\nB ", " C\r\nD ")).toEqual({ ok: true, fr: "A\nB", en: "C\nD" });
  });

  it.each([
    ["nope", "x", "y", "UNKNOWN_COPY_KEY"],
    ["home.hero.title", "", "y", "COPY_EMPTY"],
    ["home.hero.title", "x".repeat(161), "y", "COPY_TOO_LONG"],
    ["home.hero.title", "x", "", "COPY_EN_EMPTY"],
    ["home.hero.title", "x", "  \n ", "COPY_EN_EMPTY"],
    ["home.hero.title", "x", null, "COPY_EN_EMPTY"],
    ["home.hero.title", "x", "y".repeat(161), "COPY_EN_TOO_LONG"],
  ])("refuse (%s, %s, %s) → %s", (key, fr, en, error) => {
    expect(validateBilingualSiteCopy(key, fr, en)).toEqual({ ok: false, error });
  });

  it("le français d'abord : un texte vide dans les deux langues désigne le champ français", () => {
    expect(validateBilingualSiteCopy("home.hero.title", "", "")).toEqual({ ok: false, error: "COPY_EMPTY" });
  });

  it("chaque refus de saisie désigne son champ et a sa phrase", () => {
    expect(SITE_COPY_FIELD_ERRORS).toEqual({ COPY_EMPTY: "fr", COPY_TOO_LONG: "fr", COPY_EN_EMPTY: "en", COPY_EN_TOO_LONG: "en" });
    expect(siteCopyErrorMessage("COPY_EN_EMPTY", "x")).toBe(SITE_COPY_ERROR_MESSAGES.COPY_EN_EMPTY);
    expect(siteCopyErrorMessage("FORBIDDEN", "repli")).toBe("repli");
    expect(siteCopyErrorMessage("constructor", "repli")).toBe("repli");
  });
});

describe("resolveSiteCopy — règle de rattrapage", () => {
  it("rien en base : défauts des deux langues, rien à rattraper", () => {
    const bundle = resolveSiteCopy(new Map());
    expect(bundle.fr).toEqual(defaultSiteCopy("fr"));
    expect(bundle.en).toEqual(defaultSiteCopy("en"));
    expect(bundle.missingEn).toEqual([]);
    expect(bundle.editor["home.join.title"]).toEqual({
      fr: defaultSiteCopy("fr")["home.join.title"],
      en: defaultSiteCopy("en")["home.join.title"],
      enMissing: false,
    });
  });

  it("français édité sans anglais : l'anglais d'origine sous /en, jamais le français ; texte à rattraper", () => {
    const bundle = resolveSiteCopy(new Map([["copy_ranking.hero.lede", "Nouveau sous-titre"]]));
    expect(bundle.fr["ranking.hero.lede"]).toBe("Nouveau sous-titre");
    expect(bundle.en["ranking.hero.lede"]).toBe(defaultSiteCopy("en")["ranking.hero.lede"]);
    expect(Object.values(bundle.en)).not.toContain("Nouveau sous-titre");
    expect(bundle.missingEn).toEqual(["ranking.hero.lede"]);
    expect(bundle.editor["ranking.hero.lede"]).toEqual({ fr: "Nouveau sous-titre", en: "", enMissing: true });
  });

  it("anglais enregistré : servi, et le texte sort de la liste", () => {
    const bundle = resolveSiteCopy(
      new Map([
        ["copy_ranking.hero.lede", "Nouveau sous-titre"],
        ["copy_ranking.hero.lede__en", "New subtitle"],
      ]),
    );
    expect(bundle.en["ranking.hero.lede"]).toBe("New subtitle");
    expect(bundle.missingEn).toEqual([]);
    expect(bundle.editor["ranking.hero.lede"]).toEqual({ fr: "Nouveau sous-titre", en: "New subtitle", enMissing: false });
  });

  it("une valeur vide vaut une clé absente, dans les deux langues", () => {
    const bundle = resolveSiteCopy(
      new Map([
        ["copy_home.hero.title", "   "],
        ["copy_home.hero.title__en", ""],
      ]),
    );
    expect(bundle.fr["home.hero.title"]).toBe(defaultSiteCopy("fr")["home.hero.title"]);
    expect(bundle.en["home.hero.title"]).toBe(defaultSiteCopy("en")["home.hero.title"]);
    expect(bundle.missingEn).toEqual([]);
  });
});
