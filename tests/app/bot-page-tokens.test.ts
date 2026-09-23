import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

const read = (path: string) => readFileSync(path, "utf8");
const isSource = (path: string) => /\.(css|tsx?)$/.test(path);

// Les définitions : toute feuille de `app/` et `components/` (un jeton défini
// sous un sélecteur ne vaut que sous lui, mais le site n'en pose qu'à la racine
// et les écarts se verraient ailleurs), et les polices que `next/font` expose
// par `variable: "--font-…"`.
const definitionSources = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))].filter(isSource);
const defined = new Set<string>();
for (const path of definitionSources) {
  const text = read(path);
  for (const m of text.matchAll(/(?:^|[\s{;"'])(--[a-zA-Z0-9-]+)\s*["']?\s*:/g)) defined.add(m[1]);
  for (const m of text.matchAll(/variable:\s*["'](--[a-zA-Z0-9-]+)["']/g)) defined.add(m[1]);
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
