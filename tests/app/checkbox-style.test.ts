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
/** Le corps de la première règle dont le sélecteur porte ce fragment. */
function blockFor(fragment: string, css: string = globals): string {
  const at = css.indexOf(fragment);
  expect(at).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** La règle de base, partagée par la case et le radio. */
const CHECKBOX_BLOCK = blockFor('input[type="checkbox"],\ninput[type="radio"] {');

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
    expect(CHECKBOX_BLOCK).toMatch(/padding: 0/);
  });

  it("habille aussi le bouton radio, qui n'est qu'une case ronde", () => {
    expect(CHECKBOX_BLOCK).toContain("appearance: none");
    expect(blockFor('input[type="radio"] {\n  border-radius')).toContain("border-radius: 50%");
  });

  it("dessine la marque en image de fond, un input n'ayant pas de pseudo-élément garanti", () => {
    expect(blockFor('input[type="checkbox"]:checked {')).toContain("background-image: url(");
    expect(blockFor('input[type="radio"]:checked {\n  background-image')).toContain(
      "background-image: url(",
    );
    expect(globals).not.toContain('input[type="checkbox"]::after');
  });

  it("donne un anneau de focus clavier — `appearance: none` le retire", () => {
    expect(blockFor('input[type="checkbox"]:focus-visible,')).toContain("box-shadow");
  });

  it("marque l'état désactivé", () => {
    expect(blockFor('input[type="checkbox"]:disabled,')).toContain("cursor: not-allowed");
  });

  it("rend la main au système en contrastes forcés", () => {
    // Le mode force la couleur de fond mais **pas** l'image : une coche presque
    // noire finirait sur un fond noir imposé, et cochée vaudrait décochée.
    const forced = globals.slice(globals.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain("appearance: auto");
    expect(forced).toContain("background-image: none");
    // Le `box-shadow` du focus est supprimé lui aussi : il faut une `outline`.
    expect(forced).toMatch(/outline: 2px solid/);
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
  "margin",
  "display",
  "border",
  "background",
  "box-shadow",
  // Un `flex: 1` pose `flex-basis: 0%` : sur une case de 16 px dans une rangée
  // flex, le `flex-shrink: 0` global ne la protège pas d'un socle nul.
  "flex",
  "min-width",
  "max-width",
  // `appearance: none` retire l'anneau natif : `outline` fait désormais partie
  // de ce qui peut casser le contrôle sans qu'on le voie.
  "outline",
];

/**
 * Un `input` sans `[type=…]` accolé : ce compound-là attrape les cases. La
 * parenthèse ouvrante compte parmi les débuts possibles — `:is(input, textarea)`
 * vise l'élément nu tout autant que `.x input`.
 */
const BARE_INPUT = /(^|[\s>+~,(])input(?![\w-]|\[|\s*\{)/;

type Offender = { file: string; selector: string };

/**
 * Le compound sort-il **les deux** contrôles ? L'exclusion ne vaut que dans un
 * `:not(…)` : un `:is([type="checkbox"], [type="radio"])` nomme les mêmes types
 * pour mieux les viser, et pèse alors plus lourd que la règle globale.
 */
function excludesBoth(compound: string): boolean {
  const negated = [...compound.matchAll(/:not\(([^()]*)\)/g)].map((m) => m[1]).join(" ");
  return negated.includes('[type="checkbox"]') && negated.includes('[type="radio"]');
}

/**
 * Découpe une liste de sélecteurs sur ses virgules **de premier niveau** : celle
 * d'un `:not([type="checkbox"], [type="radio"])` appartient au sélecteur, la
 * couper le mutilerait et ferait passer l'exclusion pour absente.
 */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selector) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
}

function bareInputOffenders(path: string, css: string): Offender[] {
  const offenders: Offender[] = [];
  // Les commentaires partent **d'abord** : le découpage naïf ci-dessous les
  // replie dans le sélecteur, si bien qu'une règle précédée d'un commentaire —
  // la forme même que laisse ce correctif — passait tout entière au travers.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Découpage volontairement naïf (`sélecteur { déclarations }`) : ces feuilles
  // n'ont ni `@media` imbriqué dans une règle ni accolade dans une valeur.
  for (const [, rawSelector, body] of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rawSelector.trim().replace(/\s+/g, " ");
    if (selector.startsWith("@") || selector === "") continue;
    const compounds = splitSelectorList(selector);
    const bare = compounds.filter((part) => BARE_INPUT.test(part) && !excludesBoth(part));
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
  // Toutes les feuilles, pas seulement celles de module : `/bot` en importe deux
  // qui sont globales (`bot.css`, `docs/docs.css`) et pèsent donc autant.
  const sheets = walk(join(ROOT, "app"), ".css")
    .concat(walk(join(ROOT, "components"), ".css"))
    .map((path) => ({ path, css: readFileSync(path, "utf8") }));

  it("trouve bien des feuilles à contrôler", () => {
    expect(sheets.some(({ path }) => path.endsWith("globals.css"))).toBe(true);
    expect(sheets.some(({ path }) => path.endsWith(".module.css"))).toBe(true);
    // Les feuilles globales hors module comptent aussi.
    expect(
      sheets.some(({ path }) => path.endsWith("bot.css") || path.endsWith("docs.css")),
    ).toBe(true);
  });

  it("n'habille jamais un `input` nu sans exclure la case à cocher", () => {
    const offenders = sheets.flatMap(({ path, css }) => bareInputOffenders(path, css));
    expect(offenders).toEqual([]);
  });

  it("laisse libre le sélecteur qui nomme son type", () => {
    // Le garde-fou ne doit pas interdire d'habiller un bouton radio, que la
    // règle globale ne couvre pas : il ne vise que l'`input` nu.
    expect(bareInputOffenders("x.css", 'input[type="date"] { padding: 4px; }')).toEqual([]);
    expect(bareInputOffenders("x.css", ".a > input { width: auto; }")).toHaveLength(1);
    expect(bareInputOffenders("x.css", '.a input[type="checkbox"] { width: auto; }')).toEqual([]);
    const excluded = '.a input:not([type="checkbox"]):not([type="radio"]) { width: auto; }';
    expect(bareInputOffenders("x.css", excluded)).toEqual([]);
    // Nommer les deux types pour mieux les **viser** n'est pas les exclure.
    const targeted = '.a input:is([type="checkbox"], [type="radio"]) { width: auto; }';
    expect(bareInputOffenders("x.css", targeted)).toHaveLength(1);
    // `flex: 1` donne un socle nul à un contrôle de 16 px.
    expect(bareInputOffenders("x.css", ".a input { flex: 1; }")).toHaveLength(1);
    // Exclure la case sans exclure le radio ne suffit plus : les deux sont posés
    // sur l'élément.
    const half = '.a input:not([type="checkbox"]) { width: auto; }';
    expect(bareInputOffenders("x.css", half)).toHaveLength(1);
    // Un `:is(…)` vise l'élément nu tout autant qu'un descendant écrit à plat.
    const wrapped = ".panel :is(input, textarea) { padding: 8px; }";
    expect(bareInputOffenders("x.css", wrapped)).toHaveLength(1);
    // `outline` casse l'anneau de focus, que `appearance: none` a retiré.
    expect(bareInputOffenders("x.css", ".a input:focus { outline: 2px solid; }")).toHaveLength(1);
    expect(bareInputOffenders("x.css", "input, textarea { font: inherit; }")).toEqual([]);
    // La virgule d'un `:not(…)` n'est pas celle d'une liste de sélecteurs.
    expect(splitSelectorList('a:not(.x, .y), b')).toEqual(["a:not(.x, .y)", "b"]);
    // Un commentaire au-dessus ne doit plus servir de laissez-passer.
    expect(bareInputOffenders("x.css", "/* note */\n.a input { width: auto; }")).toHaveLength(1);
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
    if (!/type=["'](checkbox|radio)["']/.test(tag)) continue;
    const style = tag.match(/style=\{\{([\s\S]*?)\}\}/);
    if (!style) {
      // Un `style={variable}` ne se lit pas d'ici : le balayage ne peut ni
      // l'innocenter ni le condamner, donc il le refuse — la règle globale doit
      // rester le seul endroit où l'apparence se décide. (Un `{...props}` sans
      // `style` reste permis : il ne porte pas d'apparence par lui-même.)
      if (/style=\{/.test(tag)) {
        offenders.push({ file: relative(ROOT, path), selector: "style non littéral" });
      }
      continue;
    }
    // Une case délibérément masquée (relais de focus d'un contrôle dessiné à
    // côté) donne sa propre boîte : elle ne peint rien.
    if (/opacity:\s*0(?![.\d])/.test(style[1])) continue;
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
    // `opacity: 0.6` n'est pas un masquage : la case se voit, donc elle est tenue.
    const faded = '<input type="checkbox" style={{ opacity: 0.6, width: 18 }} />';
    expect(inlineOffenders("x.tsx", faded)).toHaveLength(1);
    // Illisible d'ici, donc refusé : l'apparence ne se décide qu'au global.
    const opaque = '<input type="checkbox" style={someStyle} />';
    expect(inlineOffenders("x.tsx", opaque)).toHaveLength(1);
    // Un étalement de props sans `style` ne porte aucune apparence.
    const spread = '<input type="checkbox" {...props} />';
    expect(inlineOffenders("x.tsx", spread)).toEqual([]);
  });
});
