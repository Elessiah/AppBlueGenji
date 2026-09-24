import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Focus des champs qui ne vivent pas dans un `.field` (ACCESSIBILITE.md, tâche 7).
 *
 * Trois champs posaient `outline: none` et ne signalaient le focus que par une
 * bordure recolorée — un trait d'un pixel qui change de teinte, invisible à
 * l'œil (WCAG 2.4.7 / 1.4.11) et **effacé** en contrastes forcés, où le système
 * impose la couleur des bordures et supprime les `box-shadow`. Deux gardes :
 * un anneau au focus, et une `outline` sous `forced-colors`.
 *
 * Contrôle au niveau de la source, faute de pouvoir monter la cascade en test.
 */

/** Retire les commentaires : ils citent en prose les sélecteurs que ces gardes lisent. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Corps de la première règle de premier niveau dont le sélecteur est exactement `selector`. */
function ruleBody(css: string, selector: string): string {
  for (const [, rawSelector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rawSelector.trim() === selector) return body;
  }
  throw new Error(`règle introuvable : ${selector}`);
}

/** Contenu concaténé des blocs `@media (forced-colors: active)`, accolades équilibrées. */
function forcedColorsBlocks(css: string): string {
  const marker = "@media (forced-colors: active)";
  let out = "";
  let from = 0;
  for (;;) {
    const start = css.indexOf(marker, from);
    if (start === -1) return out;
    const open = css.indexOf("{", start);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out += css.slice(open + 1, i - 1) + "\n";
    from = i;
  }
}

/** Le bloc de contrastes forcés porte-t-il une `outline` sur ce sélecteur ? */
function forcedOutlineFor(css: string, selector: string): boolean {
  const blocks = forcedColorsBlocks(css);
  for (const [, rawSelector, body] of blocks.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rawSelector.split(",").map((s) => s.trim());
    if (selectors.includes(selector) && /outline:\s*2px solid/.test(body)) return true;
  }
  return false;
}

const MODULES = ["app/recrutement/page.module.css", "app/association/page.module.css"];

describe.each(MODULES)("%s — champ de modale", (path) => {
  const css = stripComments(readSource(path));

  it("retire l'outline native : c'est bien cette règle qui doit en tenir lieu", () => {
    expect(ruleBody(css, ".modalInput")).toMatch(/outline:\s*none/);
  });

  it("pose un anneau au focus, pas seulement une bordure recolorée", () => {
    expect(ruleBody(css, ".modalInput:focus")).toMatch(/box-shadow:\s*0 0 0 3px/);
  });

  it("rend un repère en contrastes forcés, où l'anneau disparaît", () => {
    expect(forcedOutlineFor(css, ".modalInput:focus")).toBe(true);
  });
});

describe("app/globals.css — barre de recherche et champs `.field`", () => {
  const css = stripComments(readSource("app/globals.css"));

  it("pose un anneau au focus de la barre de recherche", () => {
    expect(ruleBody(css, ".searchbar-input:focus")).toMatch(/box-shadow:\s*0 0 0 3px/);
  });

  it.each([
    ".searchbar-input:focus",
    '.field input:not([type="checkbox"]):not([type="radio"]):focus',
    ".field textarea:focus",
    ".field select:focus",
  ])("rend un repère en contrastes forcés : %s", (selector) => {
    expect(forcedOutlineFor(css, selector)).toBe(true);
  });
});

describe("annuaire des équipes et des joueurs — recherche", () => {
  const css = stripComments(readSource("app/(secured)/_shared/annuaire.module.css"));

  it("pose un anneau réellement visible autour de la boîte de recherche", () => {
    // À 6 % d'opacité, l'anneau d'origine ne se voyait pas.
    const body = ruleBody(css, ".search:focus-within");
    const alpha = body.match(/box-shadow:\s*0 0 0 3px rgba\(.*,\s*([\d.]+)\);?\s*$/m);
    // Le dernier argument est l'opacité — la couleur, elle, passe par `var()`.
    expect(Number(alpha?.[1])).toBeLessThanOrEqual(1);
    expect(alpha).not.toBeNull();
    expect(Number(alpha?.[1])).toBeGreaterThanOrEqual(0.25);
  });

  it("rend un repère en contrastes forcés", () => {
    expect(forcedOutlineFor(css, ".search:focus-within")).toBe(true);
  });
});
