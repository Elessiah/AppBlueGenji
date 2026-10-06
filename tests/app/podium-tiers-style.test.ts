import { describe, expect, it } from "@jest/globals";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { readSource } from "../helpers/read-source";

/**
 * Famille `.podium-tier` / `.podium-member` (app/globals.css, PODIUM_TIERS.md) :
 * trois marches lisibles au premier coup d'œil, en teintes froides, au
 * contraste tenu **sous leur propre lueur**, immobiles avec le régime de charge.
 */

const css = readSource("app/globals.css");
const start = css.indexOf("/* ---------- Marches du podium");
const block = css.slice(start, css.indexOf("/* Carte de match visee", start));
const root = /:root\s*\{([^}]*)\}/.exec(css)![1];
const SURFACE = "#161a22"; // --cyber-bg-3, le fond le plus clair (neon-palette.test.ts)

const hexOf = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(root)?.[1];
const rgbOf = (name: string) =>
  new RegExp(`${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)`).exec(root)!.slice(1, 4).map(Number) as [number, number, number];

/** Corps de la (première) règle dont le sélecteur est exactement `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const match = new RegExp(String.raw`(?:^|\n)${escaped} \{([^}]*)\}`).exec(block);
  expect(match).not.toBeNull();
  return match![1];
}

function blend(background: string, rgb: [number, number, number], alpha: number): string {
  const base = [1, 3, 5].map((index) => Number.parseInt(background.slice(index, index + 2), 16));
  return `#${base.map((value, index) => Math.round(value * (1 - alpha) + rgb[index] * alpha).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Fond au bord des lettres : la surface la plus claire, éclairée par chaque
 * lueur de la marche. Une ombre floutée d'un glyphe opaque vaut la moitié de son
 * opacité au bord du glyphe (flou gaussien d'un front) — on la compte en entier
 * pour la moitié, et on cumule toutes les lueurs : le cas le plus défavorable.
 */
function litSurface(body: string): string {
  let background = SURFACE;
  for (const [, name, alpha] of body.matchAll(/drop-shadow\([^)]*rgba\(var\((--[a-z0-9-]+-rgb)\), ([\d.]+)\)\)/g)) {
    background = blend(background, rgbOf(name), Number(alpha) / 2);
  }
  return background;
}

const TEXT_RULES = [".podium-tier-1", ".podium-tier-2", ".podium-tier-3", ".podium-member-1", ".podium-member-2", ".podium-member-3"];

describe("marches du podium — couleurs", () => {
  it.each(TEXT_RULES)("%s : chaque arrêt est un jeton de texte froid tenant 4,5:1 sous sa lueur", (selector) => {
    const body = rule(selector);
    const background = litSurface(body);
    const stops = [.../background-image:([^;]*);/.exec(body)![1].matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]);
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const name of stops) {
      const hex = hexOf(name);
      expect(hex).toBeDefined();
      expect(contrastRatio(hex!, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("n'emploie aucune teinte chaude ni couleur écrite en dur (ambre = avertissements, aucun or)", () => {
    expect(block).not.toMatch(/amber|gold|bronze|orange|#[0-9a-f]{3,6}\b/i);
  });

  it("distingue les trois marches au premier coup d'œil : dégradés différents, lueur, repère", () => {
    const gradients = [1, 2, 3].map((tier) => /background-image:([^;]*);/.exec(rule(`.podium-tier-${tier}`))![1]);
    expect(new Set(gradients).size).toBe(3);
    // 1re : irisée cyan → violet → rose ; 2e : glacier (bleus et cyan seulement) ; 3e : violet → rose.
    expect(gradients[0]).toMatch(/--cyan-400[\s\S]*--violet-300[\s\S]*--pink-400/);
    expect(gradients[1]).not.toMatch(/violet|pink/);
    expect(gradients[2]).toMatch(/--violet-[\s\S]*--pink-400/);
    for (const tier of [1, 2, 3]) expect(rule(`.podium-tier-${tier}`)).toMatch(/filter: drop-shadow/);
    // La 1re a la lueur la plus forte, et une couronne pour repère.
    expect(rule(".podium-tier-1").match(/drop-shadow/g)).toHaveLength(2);
    expect(rule(".podium-tier-1::before")).toMatch(/mask: url\("data:image\/svg\+xml/);
    expect(rule(".podium-tier")).toMatch(/font-weight: 700/);
  });

  it("garde le nom accessible : le repère est un pseudo-élément sans texte", () => {
    expect(rule(".podium-tier::before")).toMatch(/content: "";/);
  });

  it("adoucit la version des membres : ni lueur, ni repère, ni mouvement, ni graisse", () => {
    for (const tier of [1, 2, 3]) {
      expect(rule(`.podium-member-${tier}`)).not.toMatch(/filter|animation|font-weight/);
    }
    expect(block).not.toMatch(/\.podium-member[^{,]*::before/);
  });
});

describe("marches du podium — mouvement", () => {
  it("met en pause toute animation infinie avec le régime de charge (et donc le mouvement réduit)", () => {
    const infinite = block.match(/animation:[^;]*infinite[^;]*;/g) ?? [];
    expect(infinite).toHaveLength(2);
    expect(block.match(/animation-play-state: var\(--deco-anim-state\)/g)).toHaveLength(infinite.length);
  });

  it("hiérarchise : reflet le plus vif à la 1re, plus lent à la 2e, 3e immobile", () => {
    const duration = (tier: number) => Number(/animation: podium-shimmer ([\d.]+)s linear infinite/.exec(rule(`.podium-tier-${tier}`))![1]);
    expect(duration(1)).toBeLessThan(duration(2));
    expect(rule(".podium-tier-3")).not.toMatch(/animation/);
  });

  it("ne déplace que la position du fond (ni mise en page, ni couleur recalculée)", () => {
    const keyframes = /@keyframes podium-shimmer \{([\s\S]*?)\n\}/.exec(block)![1];
    expect(keyframes.match(/[a-z-]+(?=:)/g)!.every((property) => property === "background-position")).toBe(true);
  });

  it("reste peint à l'arrêt : le dégradé ne dépend d'aucune animation", () => {
    const base = rule(".podium-tier,\n.podium-member");
    expect(base).toMatch(/background-clip: text/);
    expect(base).toMatch(/-webkit-text-fill-color: transparent/);
  });
});

describe("marches du podium — accessibilité et impression", () => {
  it("garde un soulignement visible malgré le texte transparent (« Liens soulignés »)", () => {
    expect(rule(".podium-tier,\n.podium-member")).toMatch(/text-decoration-color: var\(--blue-300\)/);
  });

  it("rend une couleur pleine au survol et au focus d'un lien", () => {
    const hover = /\.entity-link\.podium-tier:hover,[\s\S]*?\{([^}]*)\}/.exec(block)![1];
    expect(hover).toMatch(/background-image: none/);
    expect(hover).toMatch(/-webkit-text-fill-color: var\(--blue-100\)/);
  });

  it("efface la lueur en contraste renforcé", () => {
    expect(block).toMatch(/:root\[data-a11y~="contrast"\] \.podium-tier \{\s*filter: none;/);
  });

  it("imprime une couleur pleine et rend la main au système en couleurs forcées", () => {
    expect(block).toMatch(/@media print \{\s*\.podium-tier,\s*\.podium-member \{\s*background: none;\s*color: var\(--blue-500\);\s*-webkit-text-fill-color: currentColor;/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.podium-tier,\s*\.podium-member \{\s*background-image: none;[^}]*-webkit-text-fill-color: currentColor;/);
  });
});
