import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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

/** Fichiers du projet portant l'extension donnée, `node_modules` exclu. */
function walk(dir: string, suffix: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(path);
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

  it("remet le rembourrage à zéro — en `border-box`, il repousserait la taille", () => {
    expect(CHECKBOX_BLOCK.slice(0, CHECKBOX_BLOCK.indexOf("}"))).toMatch(/padding: 0/);
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

/**
 * Garde anti-divergence — le seul débordement possible est la **spécificité**.
 *
 * `input[type="checkbox"]` pèse une classe et un élément : exactement le poids
 * d'un `.x input`. À égalité, c'est la dernière déclaration lue qui l'emporte,
 * et une feuille de module n'a pas d'ordre garanti vis-à-vis de `globals.css` —
 * une règle écrite pour un champ de saisie déborde donc sur la case qu'un écran
 * posera demain dans le même bloc. Le cas était réel : `.field input` imposait
 * son rembourrage (case rectangulaire, `appearance` retirée) et son anneau vert
 * au clic.
 *
 * La règle tenue ici est donc : **un sélecteur qui vise un `input` nu et décrit
 * sa boîte doit exclure la case à cocher**. Celui qui nomme son type
 * (`input[type="radio"]`, `input[type="number"]`) reste libre — il dit déjà ce
 * qu'il vise.
 */
const BOX_PROPERTIES = [
  "appearance",
  "accent-color",
  "width",
  "height",
  "padding",
  "border",
  "background",
  "box-shadow",
];

/** Un `input` sans `[type=…]` accolé : ce compound-là attrape les cases. */
const BARE_INPUT = /(^|[\s>+~,])input(?![\w-]|\[|\s*\{)/;

type Offender = { file: string; selector: string };

function bareInputOffenders(path: string, css: string): Offender[] {
  const offenders: Offender[] = [];
  // Découpage volontairement naïf (`sélecteur { déclarations }`) : ces feuilles
  // n'ont ni `@media` imbriqué dans une règle ni accolade dans une valeur.
  for (const [, rawSelector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim().replace(/\s+/g, " ");
    if (selector.startsWith("@") || selector.startsWith("/*")) continue;
    const compounds = selector.split(",").map((part) => part.trim());
    const bare = compounds.filter(
      (part) => BARE_INPUT.test(part) && !part.includes(':not([type="checkbox"])'),
    );
    if (bare.length === 0) continue;
    const declares = BOX_PROPERTIES.some((property) =>
      new RegExp(`(^|[;{\\s])${property}[\\w-]*\\s*:`).test(body),
    );
    if (declares) {
      offenders.push({ file: relative(ROOT, path), selector: bare.join(", ") });
    }
  }
  return offenders;
}

describe("Cases à cocher — aucune feuille ne redéfinit l'apparence", () => {
  const sheets = [join(ROOT, "app", "globals.css")]
    .concat(walk(join(ROOT, "app"), ".module.css"))
    .concat(walk(join(ROOT, "components"), ".module.css"))
    .map((path) => ({ path, css: readFileSync(path, "utf8") }));

  it("trouve bien des feuilles à contrôler", () => {
    expect(sheets.length).toBeGreaterThan(1);
    expect(sheets.some(({ path }) => path.endsWith(".module.css"))).toBe(true);
  });

  it("n'habille jamais un `input` nu sans exclure la case à cocher", () => {
    const offenders = sheets.flatMap(({ path, css }) => bareInputOffenders(path, css));
    expect(offenders).toEqual([]);
  });

  it("laisse libre le sélecteur qui nomme son type", () => {
    // Le garde-fou ne doit pas interdire d'habiller un bouton radio, que la
    // règle globale ne couvre pas : il ne vise que l'`input` nu.
    expect(bareInputOffenders("x.css", 'input[type="radio"] { accent-color: red; }')).toEqual([]);
    expect(bareInputOffenders("x.css", ".a > input { width: auto; }")).toHaveLength(1);
    expect(bareInputOffenders("x.css", '.a input[type="checkbox"] { width: auto; }')).toEqual([]);
    expect(bareInputOffenders("x.css", "input, textarea { font: inherit; }")).toEqual([]);
  });
});

/**
 * Garde anti-divergence — un style **en ligne** bat toute feuille.
 *
 * Deux écrans posaient `width: 18, accentColor: …` sur leur case : ils gardaient
 * donc, seuls, la taille et la teinte dont la règle venait de sortir tout le
 * site — précisément le « deux écrans voisins n'avaient pas la même » que cette
 * règle ferme. `accent-color` y est en outre mort, `appearance: none` le
 * désactivant.
 */
const INLINE_BANNED = /\b(width|height|accentColor|appearance|padding|borderRadius)\s*:/;

function inlineOffenders(path: string, source: string): Offender[] {
  const offenders: Offender[] = [];
  for (const chunk of source.split("<input").slice(1)) {
    const end = chunk.indexOf("/>");
    const tag = end === -1 ? chunk.slice(0, 600) : chunk.slice(0, end);
    if (!/type=["']checkbox["']/.test(tag)) continue;
    const style = tag.match(/style=\{\{([\s\S]*?)\}\}/);
    if (!style) continue;
    // Une case délibérément masquée (relais de focus d'un contrôle dessiné à
    // côté) donne sa propre boîte : elle ne peint rien.
    if (/opacity:\s*0\b/.test(style[1])) continue;
    if (INLINE_BANNED.test(style[1])) {
      offenders.push({ file: relative(ROOT, path), selector: style[1].trim() });
    }
  }
  return offenders;
}

describe("Cases à cocher — aucun style en ligne ne reprend la main", () => {
  const sources = walk(join(ROOT, "app"), ".tsx")
    .concat(walk(join(ROOT, "components"), ".tsx"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));

  it("trouve bien les cases du projet", () => {
    const withCheckbox = sources.filter(({ source }) => source.includes('type="checkbox"'));
    expect(withCheckbox.length).toBeGreaterThanOrEqual(8);
  });

  it("ne redit en ligne ni la taille ni la teinte de la case", () => {
    const offenders = sources.flatMap(({ path, source }) => inlineOffenders(path, source));
    expect(offenders).toEqual([]);
  });

  it("laisse passer la case volontairement masquée", () => {
    const hidden = '<input type="checkbox" style={{ opacity: 0, width: 0, height: 0 }} />';
    expect(inlineOffenders("x.tsx", hidden)).toEqual([]);
    const sized = '<input type="checkbox" style={{ width: 18, height: 18 }} />';
    expect(inlineOffenders("x.tsx", sized)).toHaveLength(1);
  });
});
