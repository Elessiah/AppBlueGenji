/**
 * Cohérence de forme des pages légales : registre de langue de `/rgpd`,
 * numérotation de ses sections, liens « règlement » du pied de page et
 * rubriques de la déclaration d'accessibilité.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESSIBILITY_STANDARD,
  EVALUATION_ENVIRONMENT,
  EVALUATION_SAMPLE,
  KNOWN_ISSUES,
} from "@/lib/shared/accessibility-statement";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("/rgpd — un seul registre de langue", () => {
  const source = read("app/rgpd/page.tsx");

  it("vouvoie partout, comme les autres pages légales", () => {
    // Texte rendu seulement : on retire commentaires JSX et lignes de code.
    const prose = source
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Bornes Unicode : `\b` tient « è » pour une frontière (« complète »).
    const second = prose.match(/(?<![\p{L}\d_])(tu|ton|ta|tes|toi|te)(?![\p{L}\d_])/u);
    expect(second?.[0] ?? null).toBeNull();
    expect(prose).toMatch(/\bvous\b/);
  });

  it("numérote ses sections sans trou ni doublon", () => {
    const numbers = [...source.matchAll(/className="eyebrow">SECTION (\d{2})/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    expect(numbers.length).toBeGreaterThan(6);
  });

  it("renvoie au contact par le numéro réel de sa section", () => {
    const contact = source.match(/SECTION (\d{2})<\/span>\s*<h2[^>]*>\s*Contact/);
    const last = [...source.matchAll(/className="eyebrow">SECTION (\d{2})/g)].pop()?.[1];
    expect(last).toBeDefined();
    expect(source).toContain(`par les moyens indiqués en section&nbsp;${last}.`);
    if (contact) expect(contact[1]).toBe(last);
  });
});

describe("pied de page — règles des tournois et règlement intérieur", () => {
  const footer = read("components/cyber/landing/PublicFooter.tsx");

  it("mène aux règles des tournois depuis COMPÉTITIONS", () => {
    const competitions = footer.slice(footer.indexOf(">COMPÉTITIONS<"), footer.indexOf(">COMMUNAUTÉ<"));
    expect(competitions).toContain('href="/regles"');
    expect(competitions).toContain("Règles des tournois");
    expect(competitions).not.toContain("REGLEMENT_URL");
  });

  it("range le règlement intérieur sous LÉGAL, nommé comme tel", () => {
    const legal = footer.slice(footer.indexOf(">LÉGAL<"));
    expect(legal).toContain("href={REGLEMENT_URL}");
    expect(legal).toContain("Règlement intérieur");
  });

  it("les conditions d'utilisation lient les règles qu'elles invoquent", () => {
    expect(read("app/conditions-utilisation/page.tsx")).toContain('href="/regles"');
  });
});

describe("déclaration d'accessibilité — rubriques du modèle", () => {
  it("vise le référentiel en vigueur", () => {
    expect(ACCESSIBILITY_STANDARD).toContain("RGAA 4.1.2");
    expect(read("ACCESSIBILITE.md").split("\n")[0]).toContain("RGAA 4.1.2 / WCAG 2.1 AA");
  });

  it("dit l'absence d'échantillon et d'environnement plutôt que de s'en taire", () => {
    expect(EVALUATION_SAMPLE).toMatch(/Aucun échantillon/);
    expect(EVALUATION_ENVIRONMENT).toMatch(/Aucun environnement de test/);
    const page = read("app/accessibilite/page.tsx");
    expect(page).toContain("{EVALUATION_SAMPLE}");
    expect(page).toContain("{EVALUATION_ENVIRONMENT}");
  });

  it("déclare tous les documents de l'association au critère 13.3", () => {
    const documents = KNOWN_ISSUES.find((issue) => issue.criterion.includes("13.3"));
    expect(documents?.detail).toContain("statuts");
    expect(documents?.detail).toContain("bulletin d'adhésion");
    expect(documents?.detail).toContain("règlement intérieur");
  });
});
