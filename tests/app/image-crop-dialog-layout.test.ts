import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./_lib/style-sweep";

/**
 * Modale de recadrage sur petit écran : à 320 px, l'aperçu de 180 px dépassait
 * la zone de recadrage et repoussait les actions sous l'écran ; en paysage,
 * elles sortaient du champ, et le cadre (`touch-action: none`) empêchait de
 * faire défiler le voile pour aller les chercher. L'aide, elle, ne parlait que
 * du clavier, geste absent d'un écran tactile.
 */
const ROOT = process.cwd();
const css = stripComments(readFileSync(join(ROOT, "components/ui/image-crop-dialog.module.css"), "utf8"));
const tsx = readFileSync(join(ROOT, "components/ui/image-crop-dialog-view.tsx"), "utf8");
/** Le crochet qui ouvre la modale, chargée à la demande (revue de performance du lot 9-2). */
const hook = readFileSync(join(ROOT, "components/ui/image-crop-dialog.tsx"), "utf8");
const SMALL = "(max-width: 640px), (max-height: 560px)";

/** Contenu d'un `@media` dont la condition contient `condition`. */
function mediaBody(condition: string): string {
  const start = css.indexOf(condition);
  if (start === -1) throw new Error(`requête média absente : ${condition}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("requête média non refermée");
}

const px = (value: string | undefined) => Number(value?.replace("px", ""));

describe("modale de recadrage — petits écrans", () => {
  it("l'aperçu tire sa taille de la feuille, jamais d'une constante du composant", () => {
    expect(tsx).toContain("var(--crop-preview-box)");
    expect(tsx).not.toMatch(/PREVIEW_BOX_PX/);
  });

  it("l'aperçu se réduit sur un écran étroit et en paysage", () => {
    const base = /--crop-preview-box:\s*(\d+px)/.exec(css)?.[1];
    const reduced = /--crop-preview-box:\s*(\d+px)/.exec(mediaBody(SMALL))?.[1];
    expect(px(reduced)).toBeLessThan(px(base));
    // Plus petit que la zone de recadrage d'un écran de 320 px (~130 px utiles).
    expect(px(reduced)).toBeLessThanOrEqual(120);
  });

  it("les actions restent collées au bas de la zone visible", () => {
    expect(mediaBody(SMALL)).toMatch(/\.footer\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/);
  });

  it("le défilement du voile ne se propage pas à la page", () => {
    expect(css).toMatch(/\.backdrop\s*\{[^}]*overscroll-behavior:\s*contain;/);
  });

  it("l'aide clavier quitte l'écran tactile sans quitter la description, l'aide au doigt reste", () => {
    const coarse = mediaBody("(pointer: coarse)");
    // Masquée visuellement seulement : `display: none` la retirerait aussi de
    // l'`aria-describedby` du cadre, qu'un clavier externe pilote encore.
    expect(coarse).toMatch(/\.hintKeys\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\);/);
    expect(coarse).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    const keys = tsx.slice(tsx.indexOf("className={s.hintKeys}"));
    expect(keys.length).toBeLessThan(tsx.length);
    // La phrase du geste au doigt n'est pas dans la partie masquée.
    // Lot 9-2 : la phrase du geste au doigt vient des messages (`hint`,
    // `hintFixed`), rendue hors de la partie masquée.
    expect(keys).not.toContain('t("hint")');
    expect(tsx).toContain('{aspect !== null ? t("hintFixed") : t("hint")}');
  });
});

/**
 * Le repère des tiers se trace par **bordures**, non par dégradés empilés : une
 * boîte par axe, calée sur le tiers central, dont les deux bordures sont les
 * deux lignes. Les quatre dégradés d'avant étalaient chaque ligne sur deux
 * pixels à demi-teinte (`calc(33.33% ± 0.5px)`), et l'analyseur CSS de
 * SonarCloud ne lisait pas cette valeur à quatre couches (bug de fiabilité
 * BLOCKER css:S9424, ouvert cinq semaines sur `main`).
 */
describe("modale de recadrage — repère des tiers", () => {
  /**
   * Le corps de la règle dont le sélecteur **ouvre** une déclaration : le
   * `}` exigé devant écarte `.grid::after` lu au milieu d'une liste de
   * sélecteurs (`.grid::before, .grid::after`), qui est une autre règle.
   */
  const blockFor = (selector: RegExp) =>
    new RegExp(`\\}\\s*${selector.source}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it("ne repose sur aucun fond : les lignes sont des bordures", () => {
    const grid = blockFor(/\.grid/);
    expect(grid).toContain("position: absolute");
    expect(grid).not.toMatch(/background|gradient/);
    expect(blockFor(/\.grid::before,\s*\.grid::after/)).toMatch(/border:\s*0 solid rgba\(255, 255, 255, 0\.25\)/);
  });

  it("pose les deux lignes de chaque axe aux tiers", () => {
    const vertical = blockFor(/\.grid::before/);
    expect(vertical).toMatch(/inset:\s*0 33\.33%/);
    expect(vertical).toMatch(/border-left-width:\s*1px/);
    expect(vertical).toMatch(/border-right-width:\s*1px/);
    const horizontal = blockFor(/\.grid::after/);
    expect(horizontal).toMatch(/inset:\s*33\.33% 0/);
    expect(horizontal).toMatch(/border-top-width:\s*1px/);
    expect(horizontal).toMatch(/border-bottom-width:\s*1px/);
  });

  it("s'efface en contrastes forcés, où une bordure prend la couleur du système", () => {
    // Le mode impose la couleur d'une bordure, pas celle d'un fond : sans cette
    // règle, le repère décoratif passerait de 0,25 de blanc à des traits pleins
    // de la teinte du cadre, par-dessus la photo — et le voile d'assombrissement
    // du cadre, un `box-shadow`, a disparu dans ce même mode.
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toMatch(/\.grid::before,\s*\.grid::after\s*\{[^}]*border-color:\s*transparent/);
  });
});

describe("modale de recadrage — langue d'un écran du staff sous /en", () => {
  it("portée dans body, elle porte la langue que l'écran lui passe", () => {
    expect(tsx).toMatch(/role="dialog"[^>]*lang=\{lang\}/);
    // Seul le français s'impose (lot 9-2) : un `lang` qui ne suivrait pas le texte serait faux (WCAG 3.1.2).
    expect(hook).toMatch(/useImageCropper\(options: Readonly<\{ lang\?: "fr" \}> = \{\}\)/);
  });

  it("les éditeurs de la vitrine (français, D4) la disent en français sous /en", () => {
    for (const file of ["app/benevoles/BenevolesSection.tsx", "components/cyber/landing/SponsorsGrid.tsx"]) {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain("useImageCropper({ lang: staffLang })");
    }
  });
});
