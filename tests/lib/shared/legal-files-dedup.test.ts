/**
 * LEGAL-FILES-DEDUP : textes juridiques écrits une fois pour les deux langues
 * (`frEn`, `docs/features/LEGAL_DATA_FILES.md`). Le français et l'anglais
 * sortent de la même structure ; ces tests vérifient qu'aucune paire n'échappe
 * à la résolution et que la forme est la même dans les deux langues.
 */
import { describe, expect, it } from "@jest/globals";

import { isBilingual } from "@/lib/shared/bilingual";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";
import type { BilingualDoc, LegalDoc } from "@/lib/shared/bot-legal-types";
import * as register from "@/lib/shared/processing-register";
import type { ProcessingActivity } from "@/lib/shared/processing-register";
import * as registerEn from "@/lib/shared/processing-register-en";

const LIST_FIELDS = ["subPurposes", "dataSubjects", "dataCategories", "retention", "recipients", "transfers", "security"] satisfies (keyof ProcessingActivity)[];

const DOCS: [string, BilingualDoc][] = [
  ["TERMS_OF_SERVICE", TERMS_OF_SERVICE],
  ["PRIVACY_POLICY", PRIVACY_POLICY],
];

/** Chemins des paires `{ fr, en }` restées dans une valeur résolue. */
function leftoverPairs(value: unknown, path = "$"): string[] {
  if (isBilingual(value)) return [path];
  if (Array.isArray(value)) return value.flatMap((item, index) => leftoverPairs(item, `${path}[${index}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leftoverPairs(item, `${path}.${key}`));
  }
  return [];
}

/** La forme d'un document : par section, la suite des blocs et leur nombre de puces. */
function shape(doc: LegalDoc): string[][] {
  return doc.sections.map((section) =>
    section.blocks.map((block) => (block.kind === "bullets" ? `bullets:${block.items?.length}` : block.kind)),
  );
}

describe("documents du bot : même forme en français et en anglais", () => {
  it.each(DOCS)("%s — botDocs_sameBlockShapeAcrossLanguages_kindsAndBulletCountsMatch", (_name, doc) => {
    expect(shape(doc.en)).toEqual(shape(doc.fr));
  });

  it.each(DOCS)("%s — botDocs_resolved_containNoLeftoverPair", (_name, doc) => {
    expect(leftoverPairs(doc.fr)).toEqual([]);
    expect(leftoverPairs(doc.en)).toEqual([]);
  });
});

describe("registre : fiches résolues dans les deux langues", () => {
  it("processingActivities_resolved_containNoLeftoverPair", () => {
    expect(leftoverPairs(register.PROCESSING_ACTIVITIES)).toEqual([]);
    expect(leftoverPairs(register.PROCESSING_ACTIVITIES_EN)).toEqual([]);
  });

  it("processingActivities_listFields_areArraysOfStrings", () => {
    for (const activity of [...register.PROCESSING_ACTIVITIES, ...register.PROCESSING_ACTIVITIES_EN]) {
      for (const field of LIST_FIELDS) {
        expect([activity.ref, field, activity[field].every((item) => typeof item === "string")]).toEqual([activity.ref, field, true]);
      }
    }
  });

  it("processingActivities_refFirst_keyOrderMatchesAcrossLanguages", () => {
    const frKeys = register.PROCESSING_ACTIVITIES.map((activity) => Object.keys(activity));
    const enKeys = register.PROCESSING_ACTIVITIES_EN.map((activity) => Object.keys(activity));

    expect(enKeys).toEqual(frKeys);
    expect(frKeys.every((keys) => keys[0] === "ref")).toBe(true);
  });
});

describe("processing-register-en : réexporte l'anglais du module français", () => {
  it("processingRegisterEn_reExports_areTheFrenchModuleValues", () => {
    const names = Object.keys(registerEn);

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const key = name as keyof typeof registerEn;
      expect([name, registerEn[key] === register[key]]).toEqual([name, true]);
    }
  });
});
