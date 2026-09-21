import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const globals = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

/**
 * L'apparence d'une case à cocher est posée **sur l'élément**, une fois.
 *
 * Huit écrans posent un `<input type="checkbox">` nu et aucun ne l'habillait :
 * la case restait celle du système — carré blanc dicté par l'OS — sur un fond
 * noir profond. Le seul réglage qu'on trouvait ici ou là, `accent-color`, ne
 * teinte que la case **cochée**.
 *
 * La règle porte donc sur le sélecteur d'élément plutôt que sur une classe ou un
 * composant : une case ajoutée demain en hérite sans que personne ait à s'en
 * souvenir, ce qui est la seule façon de fermer une panne qui tient justement à
 * ce qu'on l'oublie. Ces contrôles sont au niveau source — une feuille de style
 * n'a pas d'autre prise en test.
 */
const CHECKBOX_BLOCK = (() => {
  const start = globals.indexOf('input[type="checkbox"] {');
  expect(start).toBeGreaterThanOrEqual(0);
  return globals.slice(start);
})();

/** Toutes les feuilles de module du projet, pour la garde anti-divergence. */
function allModuleCss(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) allModuleCss(path, found);
    else if (entry.name.endsWith(".module.css")) found.push(path);
  }
  return found;
}

describe("Cases à cocher — apparence unique", () => {
  it("retire l'apparence système", () => {
    expect(CHECKBOX_BLOCK).toContain("appearance: none");
    expect(CHECKBOX_BLOCK).toContain("-webkit-appearance: none");
  });

  it("donne une taille au lieu de la laisser au système", () => {
    expect(CHECKBOX_BLOCK).toMatch(/width: 16px/);
    expect(CHECKBOX_BLOCK).toMatch(/height: 16px/);
  });

  it("dessine la coche en image de fond, un input n'ayant pas de pseudo-élément garanti", () => {
    expect(globals).toContain('input[type="checkbox"]:checked');
    const checked = globals.slice(globals.indexOf('input[type="checkbox"]:checked'));
    expect(checked).toContain("background-image: url(");
    expect(checked).not.toContain("::after");
  });

  it("donne un anneau de focus clavier — `appearance: none` le retire", () => {
    expect(globals).toContain('input[type="checkbox"]:focus-visible');
    const focus = globals.slice(globals.indexOf('input[type="checkbox"]:focus-visible'));
    expect(focus.slice(0, 200)).toContain("box-shadow");
  });

  it("marque l'état désactivé", () => {
    expect(globals).toContain('input[type="checkbox"]:disabled');
  });
});

describe("Cases à cocher — aucune feuille de module ne redéfinit l'apparence", () => {
  const sheets = allModuleCss(join(ROOT, "app"))
    .concat(allModuleCss(join(ROOT, "components")))
    .map((path) => ({ path, css: readFileSync(path, "utf8") }));

  it("trouve bien des feuilles à contrôler", () => {
    expect(sheets.length).toBeGreaterThan(0);
  });

  it("ne laisse plus aucun `accent-color`, qui ne teinte que la case cochée", () => {
    const offenders = sheets.filter(({ css }) => css.includes("accent-color"));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it("ne rend plus la case à sa taille système (`width: auto`)", () => {
    const offenders = sheets.filter(({ css }) =>
      /\binput\s*\{[^}]*width:\s*auto/.test(css),
    );
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });
});
