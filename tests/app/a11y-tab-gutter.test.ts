import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, blockFor, globals, stripComments, walk } from "./_lib/style-sweep";

/**
 * Aucune colonne de page ne passe sous l'onglet d'accessibilité.
 *
 * Au-delà de 720 px, le bouton d'accessibilité est un onglet de 28 px collé au
 * bord gauche, à mi-hauteur. L'espace connecté lui réservait une gouttière,
 * les pages vitrine non : leurs colonnes en `min(1240px, calc(100vw - 40px))`
 * ne laissaient que 12 à 20 px de chaque côté, et l'onglet mordait le début des
 * lignes. La gouttière est désormais un jeton, `--a11y-tab-gutter`, et une
 * colonne l'écrit `calc(100vw - max(<sa gouttière>, var(--a11y-tab-gutter)))`.
 */

/** Largeur de la barre de défilement que `100vw` compte sans qu'elle soit du contenu. */
const SCROLLBAR = 16;

/** Une colonne de page : `width: min(<≥ 720 px>, calc(100vw - <n>px))`, gouttière littérale. */
const LITERAL_COLUMN = /width:\s*min\(\s*(\d+)px\s*,\s*calc\(\s*100vw\s*-\s*\d+px\s*\)\s*\)/g;

/** Les en-têtes des blocs qui englobent la position donnée (`@media …`, sélecteurs). */
function enclosingHeaders(css: string, at: number): string[] {
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < at; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (ch === "}") {
      stack.pop();
      start = i + 1;
    } else if (ch === ";") {
      start = i + 1;
    }
  }
  return stack;
}

/** Vrai si la position est sous un `@media (max-width: N)` avec N ≤ 720 px — là où l'onglet est un disque. */
function underNarrowMedia(css: string, at: number): boolean {
  return enclosingHeaders(css, at).some((header) => {
    const match = /^@media[^{]*\(\s*max-width:\s*(\d+)px\s*\)/.exec(header);
    return match !== null && Number(match[1]) <= 720;
  });
}

function literalColumnOffenders(path: string, source: string): string[] {
  const css = stripComments(source);
  const offenders: string[] = [];
  for (const match of css.matchAll(LITERAL_COLUMN)) {
    if (Number(match[1]) < 720) continue; // une fenêtre flottante, pas une colonne
    if (underNarrowMedia(css, match.index ?? 0)) continue;
    offenders.push(`${path} — ${match[0]}`);
  }
  return offenders;
}

describe("gouttière de l'onglet d'accessibilité", () => {
  it("définit le jeton : nul sous 721 px, 80 px au-delà", () => {
    const css = stripComments(globals);
    expect(blockFor(/^:root\s*\{/m)).toMatch(/--a11y-tab-gutter:\s*0px/);
    expect(css).toMatch(/@media\s*\(min-width:\s*721px\)\s*\{\s*:root\s*\{\s*--a11y-tab-gutter:\s*80px;/);
  });

  it("laisse à l'onglet sa largeur de chaque côté, barre de défilement déduite", () => {
    const menu = readFileSync(join(ROOT, "components/accessibility/AccessibilityMenu.module.css"), "utf8");
    const tab = Number(/width:\s*(\d+)px/.exec(blockFor(/\.fab\s*\{/, menu))?.[1]);
    const gutter = Number(/--a11y-tab-gutter:\s*(\d+)px;\s*\}\s*\}/.exec(stripComments(globals))?.[1]);
    expect(tab).toBe(28);
    // Chaque côté : (80 − 16) / 2 = 32 px, contre 28 pour l'onglet.
    expect((gutter - SCROLLBAR) / 2).toBeGreaterThanOrEqual(tab);
  });

  it("aucune feuille n'écrit une colonne à gouttière littérale au-delà de 720 px", () => {
    const sheets = [...walk(join(ROOT, "app"), ".css"), ...walk(join(ROOT, "components"), ".css")];
    const offenders = sheets.flatMap((path) =>
      literalColumnOffenders(relative(ROOT, path), readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("les colonnes vitrine passent par le jeton", () => {
    for (const path of [
      "components/cyber/landing/Hero.module.css",
      "components/cyber/landing/PublicHeader.module.css",
      "components/cyber/landing/PublicFooter.module.css",
      "app/association/page.module.css",
      "app/regles/page.module.css",
      "app/rgpd/page.module.css",
    ]) {
      expect(readFileSync(join(ROOT, path), "utf8")).toMatch(/var\(--a11y-tab-gutter\)/);
    }
  });

  it("la colonne de /bot et /bot/docs réserve la gouttière", () => {
    expect(readFileSync(join(ROOT, "app/bot/bot.css"), "utf8")).toMatch(
      /\.container\.bot-container\s*\{[^}]*var\(--a11y-tab-gutter\)/,
    );
    for (const page of ["app/bot/page.tsx", "app/bot/docs/[[...slug]]/page.tsx"]) {
      expect(readFileSync(join(ROOT, page), "utf8")).toContain('className="container bot-container"');
    }
  });
});

describe("literalColumnOffenders", () => {
  it("refuse la colonne recopiée au premier niveau", () => {
    expect(literalColumnOffenders("x.css", ".a { width: min(1240px, calc(100vw - 40px)); }")).toHaveLength(1);
  });

  it("refuse la colonne sous une requête plus large que 720 px", () => {
    const css = "@media (max-width: 920px) { .a { width: min(1200px, calc(100vw - 24px)); } }";
    expect(literalColumnOffenders("x.css", css)).toHaveLength(1);
  });

  it("admet la gouttière mobile sous 720 px", () => {
    const css = "@media (max-width: 720px) { .a { width: min(1240px, calc(100vw - 24px)); } }";
    expect(literalColumnOffenders("x.css", css)).toEqual([]);
  });

  it("admet le jeton et les fenêtres flottantes", () => {
    const css = [
      ".a { width: min(1240px, calc(100vw - max(40px, var(--a11y-tab-gutter)))); }",
      ".b { width: min(360px, calc(100vw - 56px)); }",
    ].join("\n");
    expect(literalColumnOffenders("x.css", css)).toEqual([]);
  });

  it("ignore un motif cité en commentaire", () => {
    expect(literalColumnOffenders("x.css", "/* min(1240px, calc(100vw - 40px)) */")).toEqual([]);
  });
});
