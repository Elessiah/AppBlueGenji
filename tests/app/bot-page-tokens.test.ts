import { describe, expect, it } from "@jest/globals";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
