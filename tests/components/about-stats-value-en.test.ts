/**
 * Éditeur des chiffres « L'association » : la valeur anglaise facultative
 * (`docs/features/ABOUT_STATS_MANAGEMENT.md`) a son champ, son « i » cité par
 * le champ, son refus rattaché, et part avec le formulaire. La modale ne
 * s'ouvre qu'au clic : le câblage se lit dans la source.
 */
import { describe, expect, it } from "@jest/globals";
import { ABOUT_STAT_FIELD_ERRORS } from "@/lib/shared/about-stats";
import { readSource } from "../helpers/read-source";

const source = readSource("components/cyber/landing/AboutStats.tsx");

describe("AboutStats — valeur anglaise", () => {
  it("chaque champ désigné par un refus a son identifiant", () => {
    const ids = /const STAT_FIELD_IDS = \{([\s\S]*?)\} as const;/.exec(source)?.[1] ?? "";
    for (const field of new Set(Object.values(ABOUT_STAT_FIELD_ERRORS))) {
      expect(ids).toMatch(new RegExp(String.raw`\b${field}: "about-stat-`));
    }
  });

  it("porte un champ libellé, rattaché à son refus et à son « i »", () => {
    expect(source).toContain("htmlFor={STAT_FIELD_IDS.valueEn}");
    expect(source).toContain("Valeur en anglais (facultatif)");
    expect(source).toMatch(/<InfoHint id=\{VALUE_EN_HINT_ID\} subject="Valeur en anglais">/);
    expect(source).toContain("Laissée\n                  vide, la valeur française y est reprise.");
    expect(source).toContain('{...fieldErrors.aria("valueEn", VALUE_EN_HINT_ID)}');
    expect(source).toContain('<FieldErrorText fieldId={STAT_FIELD_IDS.valueEn} message={fieldErrors.message("valueEn")} />');
    expect(source).toContain("maxLength={ABOUT_STAT_VALUE_MAX}");
  });

  it("la valeur anglaise part avec le formulaire et revient à l'édition", () => {
    expect(source).toContain("valueEn: form.valueEn.trim(),");
    expect(source).toContain('valueEn: stat.valueEn ?? ""');
  });

  it("la carte affiche la valeur dans la langue de la page", () => {
    expect(source).toContain("{shown.map(({ stat: s, value, label, index }) => (");
    expect(source).toMatch(/<div className="num" style=\{\{ fontSize: 26 \}\}>\{value\}<\/div>/);
  });
});
