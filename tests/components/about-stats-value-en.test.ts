/**
 * Éditeur des chiffres « L'association » : la valeur anglaise facultative
 * (`docs/features/ABOUT_STATS_MANAGEMENT.md`) a son champ, son « i » cité par
 * le champ, son refus rattaché, et part avec le formulaire. La modale ne
 * s'ouvre qu'au clic : le câblage se lit dans la source.
 */
import { describe, expect, it } from "@jest/globals";
import { ABOUT_STAT_FIELD_ERRORS } from "@/lib/shared/about-stats";
import { readSource } from "../helpers/read-source";

/** La modale (chargée à la demande) et la grille de cartes qui l'ouvre. */
const source = readSource("components/cyber/landing/AboutStatEditor.tsx");
const grid = readSource("components/cyber/landing/AboutStats.tsx");

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
    expect(source).toContain("Laissée vide, la valeur française y est reprise : faite de mots ou");
    expect(source).toContain('{...fieldErrors.aria("valueEn", VALUE_EN_HINT_ID, valueEnNote !== null && VALUE_EN_MISSING_ID)}');
    expect(source).toContain('<FieldErrorText fieldId={STAT_FIELD_IDS.valueEn} message={fieldErrors.message("valueEn")} />');
    expect(source).toContain("maxLength={ABOUT_STAT_VALUE_MAX}");
  });

  it("signale sous le champ anglais une valeur saisie qui se lirait telle quelle sur /en", () => {
    expect(source).toContain('const VALUE_EN_MISSING_ID = "about-stat-value-en-missing";');
    expect(source).toContain("const valueEnMissing = aboutStatValueNeedsEnglish(form);");
    expect(source).toContain(
      '"Pas encore de valeur anglaise : la page anglaise affiche la valeur française telle quelle."',
    );
    expect(source).toContain("{valueEnNote !== null && <EnglishMissingHint id={VALUE_EN_MISSING_ID}>{valueEnNote}</EnglishMissingHint>}");
  });

  it("n'annonce qu'une fois ce que l'« i » explique déjà : l'avertissement ne reprend pas l'exemple", () => {
    const warning = /const VALUE_EN_MISSING_TEXT =\s*("[^"]*");/.exec(source)?.[1] ?? "";
    expect(warning).not.toContain("Écris-la");
    expect(warning.split(".")).toHaveLength(2);
  });

  it("marque « à revoir » une valeur anglaise gardée alors que le français a changé", () => {
    expect(source).toContain("form.valueEn.trim() === (editing.valueEn ?? \"\").trim() &&");
    expect(source).toContain("form.value.trim() !== editing.value.trim();");
    expect(source).toContain("else if (valueEnStale) valueEnNote = VALUE_EN_STALE_TEXT;");
  });

  it("l'exemple du champ anglais reprend la valeur française saisie", () => {
    expect(source).toContain('placeholder={form.value.trim() || "€4,200"}');
  });

  it("les exemples anglais de l'explication portent lang=\"en\"", () => {
    expect(source).toContain('<span lang="en">€4,200</span>');
    expect(source).toContain('<span lang="en">Free</span>');
  });

  it("Entrée passe du champ « Valeur » à l'anglais puis au titre, au lieu de ne rien faire", () => {
    expect(source).toContain("onKeyDown={focusNextOnEnter(STAT_FIELD_IDS.valueEn)}");
    expect(source).toContain("onKeyDown={focusNextOnEnter(STAT_FIELD_IDS.label)}");
    expect(source).toContain("onEnter={() => void submit()}");
  });

  it("pendant l'envoi, une frappe tardive est refusée plutôt que perdue", () => {
    expect(source.match(/readOnly=\{busy\}/g)).toHaveLength(3);
  });

  it("le bouton principal garde son nom pendant l'envoi : seul le visuel passe à « … »", () => {
    expect(source).toContain("aria-label={submitLabel}");
    expect(source).toContain('{busy ? "…" : submitLabel}');
  });

  it("la modale n'est chargée qu'au clic du staff, pas dans le morceau public", () => {
    expect(grid).toContain('import("./AboutStatEditor")');
    expect(grid).toContain("orReload(");
    expect(grid).not.toMatch(/from "@\/components\/ui\/info-hint"/);
    expect(grid).not.toContain("validateAboutStatInput");
  });

  it("la grille ne calcule la marque EN que pour les cartes qu'on peut gérer, une fois par carte", () => {
    expect(grid.match(/aboutStatNeedsEnglish\(s\)/g)).toHaveLength(1);
    expect(grid).toContain("const needsEnglish = canManage(s) && aboutStatNeedsEnglish(s);");
  });

  it("la valeur anglaise part avec le formulaire et revient à l'édition", () => {
    expect(source).toContain("valueEn: form.valueEn.trim(),");
    expect(source).toContain('valueEn: editing.valueEn ?? ""');
  });

  it("la carte affiche la valeur dans la langue de la page", () => {
    expect(grid).toContain("{shown.map(({ stat: s, value, label, index }) => {");
    expect(grid).toMatch(
      /<div className="num" style=\{\{ fontSize: 26 \}\} lang=\{aboutStatValueIsFrench\(s, locale\) \? "fr" : undefined\}>\s*\{value\}\s*<\/div>/,
    );
  });

  it("la valeur anglaise suit la valeur, avant le titre dont l'Entrée enregistre", () => {
    const value = source.indexOf("htmlFor={STAT_FIELD_IDS.value}>");
    const valueEn = source.indexOf("htmlFor={STAT_FIELD_IDS.valueEn}");
    const title = source.indexOf("<BilingualField");
    expect(value).toBeGreaterThan(-1);
    expect(valueEn).toBeGreaterThan(value);
    expect(title).toBeGreaterThan(valueEn);
  });

  it("pendant l'envoi, les boutons gardent le focus : aria-disabled + garde, jamais disabled", () => {
    const actions = /<div className=\{styles\.modalActions\}>([\s\S]*?)<\/div>/.exec(source)?.[1] ?? "";
    expect(actions).not.toMatch(/\sdisabled=\{busy\}/);
    expect(actions.match(/aria-disabled=\{busy\}/g)).toHaveLength(2);
    expect(actions).toContain("aria-busy={busy}");
    expect(source).toMatch(/async function submit\(\) \{\r?\n\s+if \(busy\) return;/);
    expect(source).toMatch(/function close\(\) \{\r?\n\s+if \(busy\) return;/);
    const css = readSource("components/cyber/landing/AboutStats.module.css");
    expect(css).toContain('.action[aria-disabled="true"]');
    expect(css).toContain('.actionPrimary[aria-disabled="true"]');
  });
});
