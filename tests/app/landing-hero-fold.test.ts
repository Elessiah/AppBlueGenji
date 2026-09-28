import { describe, expect, it } from "@jest/globals";
import { blockFor, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * L'appel principal de l'accueil au premier écran d'un portable. La position
 * du bouton ne se mesure qu'en navigateur (mesurée en direct : 603–644 px à
 * 1366×657, contre 862–903 px avant) ; on tient ici les **déclarations** qui
 * la produisent, chacune liée à ce qu'elle a gagné.
 */

const heroTsx = readSource("components/cyber/landing/Hero.tsx");
const hero = readSource("components/cyber/landing/Hero.module.css");
const discord = readSource("components/cyber/landing/DiscordCommunity.module.css");

/** Les trois termes d'un `clamp(min, préféré, max)` de premier niveau. */
function clampArgs(declaration: string): string[] {
  const match = /clamp\((.*)\)\s*;?\s*$/.exec(declaration.trim());
  if (!match) throw new Error(`Pas de clamp() : ${declaration}`);
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of match[1]) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  args.push(current.trim());
  return args;
}

function declaration(block: string, property: string): string {
  const match = new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`Propriété absente : ${property}`);
  return match[1];
}

describe("titre du hero", () => {
  it("n'a plus de taille en ligne, elle vit dans la feuille", () => {
    expect(heroTsx).not.toMatch(/fontSize:\s*"clamp\(38px, 7vw, 82px\)"/);
    expect(heroTsx).toMatch(/<h1 className=\{`display \$\{styles\.title\}`\}>/);
  });

  it("se règle sur la dimension d'écran la plus contraignante, sans dépasser 68 px", () => {
    const [min, preferred, max] = clampArgs(declaration(blockFor(/\.title\s*\{/, hero), "font-size"));
    // Plancher inchangé : le mobile garde son titre.
    expect(min).toBe("38px");
    // La hauteur compte autant que la largeur : c'est elle qui manquait.
    expect(preferred).toMatch(/^min\(\s*[\d.]+vw\s*,\s*[\d.]+vh\s*\)$/);
    // À 82 px, « gagner ensemble. » passait sur deux lignes sur un portable.
    expect(Number.parseFloat(max)).toBeLessThanOrEqual(68);
  });
});

describe("espacements du hero", () => {
  it("proportionne son haut à la hauteur d'écran, 80 px au plus", () => {
    const padding = declaration(blockFor(/\.root\s*\{/, hero), "padding");
    const [min, preferred, max] = clampArgs(padding.replace(/\s+0\s+\d+px$/, ""));
    expect(Number.parseFloat(min)).toBeLessThan(80);
    expect(preferred).toMatch(/vh$/);
    expect(max).toBe("80px");
  });

  it("resserre l'accroche et les actions", () => {
    const lede = blockFor(/\.lede\s*\{/, hero);
    expect(Number.parseFloat(declaration(lede, "line-height"))).toBeLessThan(1.8);
    expect(Number.parseFloat(declaration(lede, "margin"))).toBeLessThan(24);
    expect(Number.parseFloat(declaration(blockFor(/\.actions\s*\{/, hero), "margin-top"))).toBeLessThan(34);
  });

  it("garde le haut réduit du mobile", () => {
    const css = stripComments(hero);
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(blockFor(/\.root\s*\{/, mobile)).toMatch(/padding-top:\s*48px\s*;/);
  });
});

describe("bloc Discord du hero", () => {
  it("dessine son libellé en contour, pas en aplat", () => {
    const cta = blockFor(/\.cta\s*\{/, discord);
    // Plein blurple, il passait devant « Inscrire mon équipe ».
    expect(cta).toMatch(/background:\s*transparent\s*;/);
    expect(cta).toMatch(/border:\s*1px solid var\(--discord\)\s*;/);
    expect(cta).toMatch(/color:\s*var\(--ink\)\s*;/);
  });

  it("retrouve l'aplat au survol et au focus", () => {
    const active = blockFor(/\.root:hover \.cta,\s*\.root:focus-visible \.cta\s*\{/, discord);
    expect(active).toMatch(/background:\s*var\(--discord\)\s*;/);
    expect(active).toMatch(/color:\s*#fff\s*;/);
  });
});
