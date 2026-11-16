import { describe, expect, it } from "@jest/globals";
import { frEn, inBothLanguages, type Localizable } from "@/lib/shared/bilingual";
import { PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN, registerController, registerControllerEn } from "@/lib/shared/processing-register";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";

/**
 * `Localizable<T>` (`lib/shared/bilingual.ts`) accepte une chaîne simple là où
 * un texte attend `frEn(…)` : oubliée en anglais, une fiche ou une section
 * nouvelle partirait en français sous /en sans qu'aucun type le voie. Ce test
 * parcourt les deux langues en parallèle et refuse tout texte **identique**
 * dans les deux, hors des clés de structure (références, numéros, sortes de
 * blocs) et des mots qui s'écrivent pareil dans les deux langues (liste blanche).
 */

/** Clés de structure, communes par construction. */
const STRUCTURAL_KEYS = new Set(["ref", "num", "kind"]);

/** Mots identiques en français et en anglais — à n'étendre que pour un vrai mot commun aux deux langues. */
const SAME_IN_BOTH = new Set(["Staff", "Casters", "Contact", "CONTACT", "EXCLUSIONS", "LICENCE", "PROTECTION"]);

/** Chemins des textes identiques dans les deux langues (hors structure et liste blanche). */
function untranslated(fr: unknown, en: unknown, sameKeys: ReadonlySet<string> = STRUCTURAL_KEYS, path = "$"): string[] {
  if (typeof fr === "string") {
    const key = path.slice(path.lastIndexOf(".") + 1);
    return fr === en && !sameKeys.has(key) && !SAME_IN_BOTH.has(fr) ? [`${path}: ${fr.slice(0, 80)}`] : [];
  }
  if (Array.isArray(fr)) {
    return fr.flatMap((item, index) => untranslated(item, (en as unknown[])[index], sameKeys, `${path}[${index}]`));
  }
  if (fr !== null && typeof fr === "object") {
    const other = en as Record<string, unknown>;
    return Object.entries(fr).flatMap(([key, value]) => untranslated(value, other[key], sameKeys, `${path}.${key}`));
  }
  return [];
}

describe("textes juridiques bilingues — rien d'identique dans les deux langues", () => {
  it("registerActivities_everyTextLeaf_translatedOrAllowlisted", () => {
    expect(untranslated(PROCESSING_ACTIVITIES, PROCESSING_ACTIVITIES_EN)).toEqual([]);
  });

  it("registerController_everyTextLeaf_translatedOrAllowlisted", () => {
    // Nom et adresse du siège : des données, les mêmes dans les deux langues.
    expect(untranslated(registerController(), registerControllerEn(), new Set(["name", "seat"]))).toEqual([]);
  });

  it("botTerms_everyTextLeaf_translatedOrAllowlisted", () => {
    expect(untranslated(TERMS_OF_SERVICE.fr, TERMS_OF_SERVICE.en)).toEqual([]);
  });

  it("botPrivacy_everyTextLeaf_translatedOrAllowlisted", () => {
    expect(untranslated(PRIVACY_POLICY.fr, PRIVACY_POLICY.en)).toEqual([]);
  });

  it("walker_plainStringInBothLanguages_isReported", () => {
    const section: Localizable<{ num: string; title: string; body: string }> = {
      num: "01",
      title: frEn("Objet", "Purpose"),
      body: "Texte oublié en anglais.",
    };
    const { fr, en } = inBothLanguages(section);

    expect(untranslated(fr, en)).toEqual(["$.body: Texte oublié en anglais."]);
  });
});
