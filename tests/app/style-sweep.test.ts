import { describe, expect, it } from "@jest/globals";
import {
  bareInputOffenders,
  cssRules,
  inlineOffenders,
  splitSelectorList,
  subjectCompound,
} from "./_lib/style-sweep";

/**
 * Les cas limites du **moteur** de balayage, séparés de ce qu'on lui fait dire.
 *
 * Ils tenaient dans une seule assertion de quatre-vingt-dix lignes, où un cas
 * ajouté se perdait parmi les autres et où le premier échec masquait tous les
 * suivants. Une table les nomme un par un.
 */
const offenders = (css: string) => bareInputOffenders("x.css", css);

describe("balayage — ce qui reprend la main sur la règle d'élément", () => {
  it.each([
    ["un `input` descendant, nu", ".a > input { width: auto; }"],
    ["`flex: 1`, qui donne un socle nul à un contrôle de 16 px", ".a input { flex: 1; }"],
    ["une taille minimale, qui étire la case hors de sa boîte", ".a input { min-height: 40px; }"],
    ["`outline`, qui casse l'anneau que `appearance: none` a retiré", ".a input:focus { outline: 2px solid; }"],
    ["une opacité, qui efface la bordure seule à dessiner une case décochée", ".a input:disabled { opacity: 0.6; cursor: not-allowed; }"],
    ["un `:is(…)` qui enveloppe l'élément nu", ".panel :is(input, textarea) { padding: 8px; }"],
    ["un commentaire au-dessus, qui servait de laissez-passer", "/* note */\n.a input { width: auto; }"],
    // `all` rend la case au système d'un seul mot, sans en nommer aucun autre :
    // c'est l'idiome courant de remise à zéro d'un contrôle de formulaire, donc
    // la forme la plus probable de la panne que ce balayage ferme.
    ["`all: unset`, qui rend la case au système sans rien nommer", ".a input { all: unset; }"],
    ["`inline-size`, qui est `width` sous son nom logique", ".a input { inline-size: 40px; }"],
  ])("voit %s", (_label, css) => {
    expect(offenders(css)).toHaveLength(1);
  });

  it.each([
    [
      "une **liste** dans un `:not()` — un moteur qui ne la comprend pas jette la règle entière",
      '.a input:not([type="checkbox"], [type="radio"]) { width: auto; }',
    ],
    [
      "une liste à moitié écrite",
      '.a input:not([type="checkbox"], .x):not([type="radio"]) { width: auto; }',
    ],
    [
      "un `:is(…)` qui **vise** les deux types au lieu de les exclure",
      '.a input:is([type="checkbox"], [type="radio"]) { width: auto; }',
    ],
    [
      "une exclusion à moitié faite — les deux types sont posés sur l'élément",
      '.a input:not([type="checkbox"]) { width: auto; }',
    ],
    [
      "une exclusion qui appartient au compound voisin, pas au sujet",
      '.field input:not([type="checkbox"]):not([type="radio"]) + input { width: 100%; }',
    ],
  ])("refuse %s comme exclusion", (_label, css) => {
    expect(offenders(css)).toHaveLength(1);
  });
});

describe("balayage — ce qu'il laisse passer, et doit laisser passer", () => {
  it.each([
    ["un sélecteur qui nomme son type", 'input[type="date"] { padding: 4px; }'],
    ["une règle qui vise explicitement la case", '.a input[type="checkbox"] { width: auto; }'],
    [
      "une exclusion en chaîne, la seule forme sûre",
      '.a input:not([type="checkbox"]):not([type="radio"]) { width: auto; }',
    ],
    ["une propriété qui ne touche pas la boîte", "input, textarea { font: inherit; }"],
    // `all` est tenu au nom exact : `transition: all …` le nomme sans le poser.
    ["un `all` qui n'est qu'une valeur de transition", "input { transition: all 0.2s ease; }"],
  ])("laisse %s", (_label, css) => {
    expect(offenders(css)).toEqual([]);
  });
});

describe("splitSelectorList", () => {
  it("ne confond pas la virgule d'un `:not(…)` avec celle d'une liste", () => {
    expect(splitSelectorList("a:not(.x, .y), b")).toEqual(["a:not(.x, .y)", "b"]);
  });
});

/**
 * Le second balayage : le **style en ligne**, qui bat toute feuille.
 *
 * C'est la moitié la plus forte de l'invariant — une règle globale ne vaut que
 * si rien ne la redit sur l'élément — et la plus piégeuse à découper : une
 * valeur d'attribut peut contenir un `>` ou refermer un autre élément.
 */
const inline = (jsx: string) => inlineOffenders("x.tsx", jsx);
const checkbox = (attrs: string) => `<input type="checkbox" ${attrs} />`;

describe("balayage en ligne — ce qui reprend la main", () => {
  it.each([
    ["une taille redite", checkbox("style={{ width: 18, height: 18 }}")],
    ["une opacité partielle : la case se voit, donc elle est tenue", checkbox("style={{ opacity: 0.6, width: 18 }}")],
    ["un style opaque, illisible d'ici", checkbox("style={someStyle}")],
    [
      "un style qui suit un élément passé en attribut — son `/>` ne ferme pas la balise",
      checkbox("icon={<Check />} style={{ width: 20 }}"),
    ],
    ["un `>` dans une chaîne, qui ne ferme pas la balise", checkbox('title="a > b" style={{ width: 20 }}')],
    ["celui d'une flèche, qui vit entre accolades", checkbox("onChange={(e) => set(e)} style={{ width: 20 }}")],
    [
      "un type calculé, qui ne met pas la case hors d'atteinte",
      '<input type={isRadio ? "radio" : "checkbox"} style={{ width: 18, accentColor: "#f00" }} />',
    ],
    ["un `all`, qui rend la case au système d'un mot", checkbox('style={{ all: "revert" }}')],
    ["`inlineSize`, qui est `width` sous son nom logique", checkbox("style={{ inlineSize: 40 }}")],
  ])("voit %s", (_label, jsx) => {
    expect(inline(jsx)).toHaveLength(1);
  });
});

describe("balayage en ligne — ce qu'il laisse passer", () => {
  it.each([
    ["une case volontairement masquée", checkbox("style={{ opacity: 0, width: 0, height: 0 }}")],
    ["un étalement de props sans `style`", checkbox("{...props}")],
    [
      "`marginTop`, qui aligne la case sur son étiquette sans toucher sa boîte",
      checkbox("style={{ marginTop: 2 }}"),
    ],
    [
      "le style du **voisin** : la balise s'arrête à son `>`",
      '<input type="checkbox" />\n<span style={{ width: 20 }} />',
    ],
  ])("laisse %s", (_label, jsx) => {
    expect(inline(jsx)).toEqual([]);
  });
});

describe("subjectCompound — l'élément que le sélecteur habille", () => {
  it.each<[string, string]>([
    [".a:focus-visible", ".a:focus-visible"],
    [".ligne:focus-visible .avatar", ".avatar"],
    [".a > .b:focus", ".b:focus"],
    ["input:hover:not(:disabled):not(:focus-visible)", "input:hover"],
    [".x:not(:is(:focus-visible))", ".x"],
    [".option:has(input:focus-visible)", ".option"],
    [":is(.a .b):focus", ":is(.a .b):focus"],
    [".a:where(:focus-visible)", ".a:where(:focus-visible)"],
  ])("%s → %s", (selector, subject) => {
    expect(subjectCompound(selector)).toBe(subject);
  });
});

describe("cssRules — règles d'une feuille", () => {
  it("rend les règles d'un @media sans son en-tête, et découpe les listes", () => {
    const css = "/* c */ .a, .b:focus { color: red; }
@media (forced-colors: active) {
  .c { outline: 0; }
}";
    expect(cssRules(css)).toEqual([
      { selectors: [".a", ".b:focus"], body: " color: red; " },
      { selectors: [".c"], body: " outline: 0; " },
    ]);
  });
});
