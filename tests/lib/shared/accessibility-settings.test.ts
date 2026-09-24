import { describe, expect, it } from "@jest/globals";
import {
  A11Y_COOKIE,
  A11Y_COOKIE_MAX_AGE,
  A11Y_SETTINGS,
  A11Y_SETTING_KEYS,
  a11yAttribute,
  a11yCookieString,
  isA11ySettingKey,
  normalizeA11ySettings,
  parseA11yCookie,
  serializeA11ySettings,
  toggleA11ySetting,
  type A11ySettingKey,
} from "@/lib/shared/accessibility-settings";

/** Toutes les combinaisons de réglages : 2⁶ = 64 choix possibles. */
function allSubsets(): A11ySettingKey[][] {
  const subsets: A11ySettingKey[][] = [];
  for (let mask = 0; mask < 1 << A11Y_SETTING_KEYS.length; mask += 1) {
    subsets.push(A11Y_SETTING_KEYS.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return subsets;
}

describe("registre des réglages d'accessibilité", () => {
  it("décrit chaque clé une fois, dans l'ordre des clés", () => {
    expect(A11Y_SETTINGS.map((setting) => setting.key)).toEqual([...A11Y_SETTING_KEYS]);
    expect(new Set(A11Y_SETTING_KEYS).size).toBe(A11Y_SETTING_KEYS.length);
  });

  it("donne à chaque réglage un intitulé et une description", () => {
    for (const setting of A11Y_SETTINGS) {
      expect(setting.label.trim().length).toBeGreaterThan(0);
      expect(setting.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("n'emploie que des clés sûres dans un cookie comme dans un attribut", () => {
    // Ni espace (séparateur de l'attribut), ni point (séparateur du cookie),
    // ni caractère qui demanderait un encodage.
    for (const key of A11Y_SETTING_KEYS) expect(key).toMatch(/^[a-z]+$/);
  });

  it("reconnaît une clé du registre et rien d'autre", () => {
    expect(isA11ySettingKey("contrast")).toBe(true);
    expect(isA11ySettingKey("CONTRAST")).toBe(false);
    expect(isA11ySettingKey("zoom")).toBe(false);
    expect(isA11ySettingKey(undefined)).toBe(false);
    expect(isA11ySettingKey(42)).toBe(false);
  });
});

describe("normalizeA11ySettings", () => {
  it("remet les clés dans l'ordre du registre, sans doublon", () => {
    expect(normalizeA11ySettings(["motion", "contrast", "motion", "focus"])).toEqual([
      "contrast",
      "focus",
      "motion",
    ]);
  });

  it("rend une liste vide pour une entrée vide", () => {
    expect(normalizeA11ySettings([])).toEqual([]);
  });
});

describe("parseA11yCookie", () => {
  it("ne lit rien d'un cookie absent ou vide", () => {
    expect(parseA11yCookie(undefined)).toEqual([]);
    expect(parseA11yCookie(null)).toEqual([]);
    expect(parseA11yCookie("")).toEqual([]);
  });

  it("lit les clés connues dans l'ordre du registre", () => {
    expect(parseA11yCookie("focus.contrast")).toEqual(["contrast", "focus"]);
  });

  it("ignore une clé inconnue — un réglage retiré ne casse pas la page", () => {
    expect(parseA11yCookie("contrast.zoom.links")).toEqual(["contrast", "links"]);
    expect(parseA11yCookie("n'importe quoi")).toEqual([]);
  });

  it("tolère les doublons, les blancs et les séparateurs vides", () => {
    expect(parseA11yCookie(" font ..font. motion ")).toEqual(["font", "motion"]);
  });

  it("refuse une valeur démesurée plutôt que de la découper", () => {
    expect(parseA11yCookie(`contrast.${"x".repeat(300)}`)).toEqual([]);
  });

  it("relit exactement ce qu'il a écrit, pour chacune des 64 combinaisons", () => {
    for (const subset of allSubsets()) {
      expect(parseA11yCookie(serializeA11ySettings(subset))).toEqual(subset);
    }
  });
});

describe("serializeA11ySettings / a11yAttribute", () => {
  it("écrit une valeur de cookie normalisée", () => {
    expect(serializeA11ySettings(["links", "contrast"])).toBe("contrast.links");
    expect(serializeA11ySettings([])).toBe("");
  });

  it("n'écrit aucun attribut quand rien n'est actif : le site reste celui d'origine", () => {
    expect(a11yAttribute([])).toBeUndefined();
  });

  it("écrit une liste de mots lisible par le sélecteur `~=`", () => {
    expect(a11yAttribute(["motion", "contrast"])).toBe("contrast motion");
  });
});

describe("toggleA11ySetting", () => {
  it("ajoute une clé à sa place", () => {
    expect(toggleA11ySetting(["motion"], "contrast", true)).toEqual(["contrast", "motion"]);
  });

  it("retire une clé", () => {
    expect(toggleA11ySetting(["contrast", "motion"], "contrast", false)).toEqual(["motion"]);
  });

  it("est idempotent", () => {
    expect(toggleA11ySetting(["contrast"], "contrast", true)).toEqual(["contrast"]);
    expect(toggleA11ySetting([], "contrast", false)).toEqual([]);
  });

  it("ne modifie pas la liste reçue", () => {
    const current: A11ySettingKey[] = ["focus"];
    toggleA11ySetting(current, "links", true);
    expect(current).toEqual(["focus"]);
  });
});

describe("a11yCookieString", () => {
  it("garde le choix un an, sur tout le site", () => {
    const cookie = a11yCookieString(["focus", "contrast"], false);
    expect(cookie).toBe(`${A11Y_COOKIE}=contrast.focus; Path=/; Max-Age=${A11Y_COOKIE_MAX_AGE}; SameSite=Lax`);
    expect(A11Y_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
  });

  it("n'est marqué `Secure` que servi en HTTPS", () => {
    expect(a11yCookieString(["focus"], true)).toMatch(/; Secure$/);
    expect(a11yCookieString(["focus"], false)).not.toMatch(/Secure/);
  });

  it("efface le cookie quand plus rien n'est actif", () => {
    expect(a11yCookieString([], false)).toBe(`${A11Y_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  });
});
