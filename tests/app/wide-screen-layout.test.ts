import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./_lib/style-sweep";

/**
 * Grands écrans (`docs/features/WIDE_SCREEN_LAYOUT.md`) : annuaires élargis au
 * delà de 1800 px, commandes sur une rangée, et colonnes du tableau /rgpd.
 * Mise en page contrôlée sur la source, comme `rgpd-player-responsive.test.ts`.
 */
const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

const GLOBALS = stripComments(read("app/globals.css"));
const TOURNAMENTS = read("app/(secured)/tournois/TournamentsList.tsx");
const TOURNAMENTS_CSS = stripComments(read("app/(secured)/tournois/tournois.module.css"));
const TEAMS = read("app/(secured)/equipes/page.tsx");
const DIRECTORY_CSS = stripComments(read("app/(secured)/_shared/annuaire.module.css"));
const RGPD_CSS = stripComments(read("app/rgpd/page.module.css"));

/** Corps de la première requête média `<feature>: <n>px` de la feuille. */
function mediaBlock(css: string, feature: "min-width" | "max-width", width: number): string {
  const start = css.indexOf(`@media (${feature}: ${width}px)`);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("requête média non refermée");
}

/** Corps de la première règle dont le sélecteur est exactement `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("annuaires sur grand écran", () => {
  const wide = mediaBlock(GLOBALS, "min-width", 1800);

  it("élargit la colonne des pages `.page-wide` seulement, gouttière d'accessibilité comprise", () => {
    expect(wide).toMatch(
      /\.page-shell:has\(\.page-wide\)\s*\{\s*width:\s*min\(1680px,\s*calc\(100vw - max\(80px,\s*var\(--a11y-tab-gutter\)\)\)\)/,
    );
    expect(wide).toMatch(/\.page-wide \.container\s*\{\s*width:\s*calc\(100% - 48px\)/);
  });

  it("garde la colonne de 1200 px partout ailleurs", () => {
    expect(ruleBody(GLOBALS, ".page-shell")).toMatch(/width:\s*min\(1200px/);
  });

  it("marque la liste des tournois et l'annuaire des équipes", () => {
    expect(TOURNAMENTS).toContain("className={`${s.page} page-wide`}");
    expect(TEAMS).toContain('className="page-wide"');
  });

  it.each([
    ["tournois", TOURNAMENTS, TOURNAMENTS_CSS, "sectionNav"],
    ["équipes", TEAMS, DIRECTORY_CSS, "sortRow"],
  ])("%s : commandes groupées, sans boîte sous le seuil, en une rangée au-delà", (_page, source, css, second) => {
    const controls = source.indexOf("className={s.controls}");
    expect(controls).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("className={s.toolbar}")).toBeGreaterThan(controls);
    expect(source.indexOf(`className={s.${second}}`)).toBeGreaterThan(controls);

    expect(ruleBody(css, ".controls")).toMatch(/display:\s*contents/);
    const large = mediaBlock(css, "min-width", 1800);
    expect(large).toMatch(/\.controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
  });

  it("passe les grilles de cartes à quatre colonnes au même seuil", () => {
    expect(mediaBlock(TOURNAMENTS_CSS, "min-width", 1800)).toMatch(
      /\.sectionBody\s*\{\s*grid-template-columns:\s*repeat\(4, 1fr\)/,
    );
    expect(mediaBlock(DIRECTORY_CSS, "min-width", 1800)).toMatch(
      /\.tmGrid\s*\{\s*grid-template-columns:\s*repeat\(4, 1fr\)/,
    );
  });
});

describe("/rgpd — colonnes du tableau des données", () => {
  it("fixe la largeur des colonnes par l'en-tête", () => {
    expect(ruleBody(RGPD_CSS, ".dataTable")).toMatch(/table-layout:\s*fixed/);
    const widths = [1, 2, 3, 4].map((n) =>
      Number(/width:\s*(\d+)%/.exec(ruleBody(RGPD_CSS, `.dataTable th:nth-child(${n})`))?.[1]),
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("donne à la finalité la plus large part, devant l'intitulé de la donnée", () => {
    const width = (n: number) =>
      Number(/width:\s*(\d+)%/.exec(ruleBody(RGPD_CSS, `.dataTable th:nth-child(${n})`))?.[1]);
    expect(width(2)).toBeGreaterThan(width(1));
    expect(width(2)).toBe(Math.max(width(1), width(2), width(3), width(4)));
  });

  it("laisse l'intitulé de la donnée revenir à la ligne", () => {
    expect(ruleBody(RGPD_CSS, ".dataTable td:first-child")).not.toMatch(/nowrap/);
  });
});
