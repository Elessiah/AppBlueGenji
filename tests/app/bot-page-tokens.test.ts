import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "../helpers/read-source";

/**
 * `/bot` est née d'une maquette qui avait ses propres noms de jetons (`--mono`,
 * `--display`, `--fg-dim`, `--bg`, `--r-lg`…), définis nulle part dans le site.
 * Une déclaration dont la variable est absente n'est pas une erreur : elle est
 * **invalide au calcul**, donc héritée ou abandonnée — le « mono » s'affichait
 * en Inter, les sur-titres dans la couleur de leur parent, le fond des panneaux
 * disparaissait. Rien ne casse, rien ne se voit à la relecture : seul un
 * balayage peut tenir la règle.
 *
 * Est contrôlé tout `var(--x)` **sans repli** des fichiers de `/bot`. Un repli
 * (`var(--c, var(--blue-500))`) est une absence prévue — la variable est posée
 * en ligne par le composant quand il en a une.
 */
const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const read = readSource;
const isSource = (path: string) => /\.(css|tsx?)$/.test(path);

// Les définitions **qui valent partout** : les blocs `:root` des feuilles
// globales (pas des modules CSS), et les polices que `next/font` expose par
// `variable: "--font-…"`. Un jeton déclaré sous un sélecteur ne vaut que sous
// lui : le compter ici laisserait passer un `var(--g-rgb)` que `/bot` ne
// résout pas.
const appAndComponents = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const defined = new Set<string>();
for (const path of appAndComponents.filter((p) => p.endsWith(".css") && !p.endsWith(".module.css"))) {
  for (const block of read(path).matchAll(/:root[^{]*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
  }
}
for (const path of appAndComponents.filter((p) => p.endsWith(".tsx"))) {
  for (const m of read(path).matchAll(/variable:\s*["'](--[a-zA-Z0-9-]+)["']/g)) defined.add(m[1]);
}

const botFiles = [...walk(join(ROOT, "app", "bot")), ...walk(join(ROOT, "components", "bot"))].filter(isSource);

describe("/bot — n'emploie que des jetons que le site définit", () => {
  it("trouve bien des fichiers et des définitions à confronter", () => {
    // Sans ce garde, un chemin déplacé rendrait le balayage vide — donc vert.
    expect(botFiles.length).toBeGreaterThan(5);
    for (const token of ["--font-mono", "--font-display", "--ink-dim", "--cyber-bg", "--r-cy-lg"]) {
      expect(defined).toContain(token);
    }
  });

  it("ne laisse aucun `var(--x)` sans repli désigner un jeton absent", () => {
    const missing: string[] = [];
    for (const path of botFiles) {
      for (const m of read(path).matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)) {
        if (!defined.has(m[1])) missing.push(`${relative(ROOT, path)} → ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("ne garde aucun des noms de la maquette", () => {
    const legacy = /var\(--(mono|display|fg|fg-dim|fg-mute|bg|r-lg|r-sm)\)/;
    const offenders = botFiles.filter((path) => legacy.test(read(path))).map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});

describe("/bot — les pastilles d'en-tête de panneau ont un habillage", () => {
  const css = read("app/bot/bot.css");

  it("habille `.chip` et distingue la pastille active", () => {
    // Sans règle, les plages du graphe s'affichaient en boutons natifs blancs,
    // et rien ne disait laquelle était affichée.
    expect(css).toMatch(/\.panel-head \.chip \{[^}]*border:/);
    expect(css).toMatch(/\.panel-head \.chip-on[,\s][^{]*\{[^}]*background:/);
    // Et le parcours clavier garde un repère, de la même teinte que l'état actif.
    expect(css).toMatch(/\.panel-head \.chip:focus-visible \{[^}]*outline:/);
  });
});

/**
 * Même panne, côté classes : `btn-primary`, `btn-ghost`, `row` et `gap-2`
 * venaient de la maquette et n'étaient définies **nulle part** — « Inviter »
 * et « Documentation » portaient donc le même habillage `.btn`, sans
 * hiérarchie, et `row gap-2` n'espaçait rien. Une classe absente ne lève rien :
 * seul un balayage la voit.
 *
 * Sont contrôlés les noms écrits en dur dans un `className` des fichiers de
 * `/bot` — attribut littéral, ou morceaux littéraux d'une expression
 * (`"chip" + (on ? " chip-on" : "")`). Une classe calculée (`"tag " + f.type`)
 * n'est vérifiée que pour sa partie fixe.
 */
describe("/bot — n'emploie que des classes que le site définit", () => {
  // Seules les feuilles que `/bot` **charge** : la feuille globale de la mise
  // en page racine et celles de `app/bot`. Une classe définie dans la feuille
  // d'une autre route n'a aucun effet ici, l'App Router ne chargeant que ce
  // que la route importe.
  const botSheets = [
    join(ROOT, "app", "globals.css"),
    ...walk(join(ROOT, "app", "bot")).filter((p) => p.endsWith(".css") && !p.endsWith(".module.css")),
  ];
  const definedClasses = new Set<string>();
  for (const path of botSheets) {
    // Seuls les **sélecteurs** définissent une classe : les commentaires et
    // les blocs de déclarations sont vidés d'abord (un `url(x.webp)` ou un
    // `0.5s` n'est pas une classe).
    let text = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
    let previous = "";
    while (previous !== text) {
      previous = text;
      text = text.replace(/\{[^{}]*\}/g, "{}");
    }
    for (const m of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) definedClasses.add(m[1]);
  }

  /** Extrait les noms de classe fixes des `className` d'une source. */
  function staticClassNames(source: string): string[] {
    const names: string[] = [];
    for (const m of source.matchAll(/className=["']([^"']*)["']/g)) names.push(...m[1].split(/\s+/));
    let at = source.indexOf("className={");
    while (at !== -1) {
      // Accolades équilibrées : un `${…}` de gabarit n'arrête pas l'expression.
      let depth = 0;
      let end = at + "className=".length;
      for (; end < source.length; end++) {
        if (source[end] === "{") depth++;
        else if (source[end] === "}" && --depth === 0) break;
      }
      let expr = source.slice(at + "className={".length, end);
      // Un gabarit donne ses parties fixes, et ses interpolations sont remises
      // dans l'expression : `${on ? "online" : ""}` porte lui aussi une classe.
      const inner: string[] = [];
      expr = expr.replace(/`([^`]*)`/g, (_, body: string) => {
        names.push(...body.replace(/\$\{([^}]*)\}/g, (_m, code: string) => (inner.push(code), " ")).split(/\s+/));
        return " ";
      });
      // Un littéral comparé (`state === "OPERATIONAL"`) est une valeur testée,
      // pas une classe posée. Les littéraux sont lus **tous**, dans l'ordre, et
      // le contexte examiné après coup : un motif qui en sauterait un se
      // recalerait sur son guillemet fermant et lirait « " ? " » comme une chaîne.
      const code = [expr, ...inner].join(" ");
      for (const lit of code.matchAll(/"([^"]*)"|'([^']*)'/g)) {
        const before = code.slice(0, lit.index);
        const after = code.slice(lit.index! + lit[0].length);
        if (/[=!]==?\s*$/.test(before) || /^\s*[=!]==?/.test(after)) continue;
        names.push(...(lit[1] ?? lit[2] ?? "").split(/\s+/));
      }
      at = source.indexOf("className={", end);
    }
    return names.filter((n) => /^-?[_a-zA-Z][\w-]*$/.test(n));
  }

  const botTsx = botFiles.filter((p) => p.endsWith(".tsx"));

  it("trouve bien des classes à confronter", () => {
    // Garde du balayage : un motif cassé rendrait l'ensemble vide — donc vert.
    expect(botSheets.map((p) => relative(ROOT, p).split(sep).join("/"))).toEqual(
      expect.arrayContaining(["app/globals.css", "app/bot/bot.css", "app/bot/docs/docs.css"]),
    );
    for (const name of ["panel-head", "chip", "chip-on", "status-cell", "bot-cta"]) {
      expect(definedClasses).toContain(name);
    }
    expect(botTsx.flatMap((p) => staticClassNames(read(p)))).toEqual(
      expect.arrayContaining(["chip", "chip-on", "status-cell", "online"]),
    );
  });

  it("repère une classe absente, écrite en attribut comme en expression", () => {
    expect(staticClassNames(`<a className="btn btn-ghost" />`)).toEqual(["btn", "btn-ghost"]);
    expect(staticClassNames("<b className={'row' + (x ? ' gap-2' : '')} />")).toEqual(["row", "gap-2"]);
    expect(staticClassNames("<p className={`cell ${s === \"UP\" ? \"online\" : \"\"}`} />")).toEqual([
      "cell",
      "online",
    ]);
    expect(staticClassNames("<i className={`cell ${on ? \"online\" : \"\"}`} />")).toEqual([
      "cell",
      "online",
    ]);
  });

  it("ne laisse aucun `className` désigner une classe absente", () => {
    const missing: string[] = [];
    for (const path of botTsx) {
      for (const name of staticClassNames(read(path))) {
        if (!definedClasses.has(name)) missing.push(`${relative(ROOT, path)} → .${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
