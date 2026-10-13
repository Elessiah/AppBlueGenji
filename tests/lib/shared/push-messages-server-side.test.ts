import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Revue performance du lot 9-3 : `lib/shared/push-messages.ts` embarque le
 * texte des notifications **dans les deux langues** (et les catégories de
 * signalement des deux `reports.json`). Il ne sert qu'au serveur ; un seul
 * module client qui l'atteindrait, même par un détour, enverrait l'anglais à
 * toutes les pages françaises qui chargent ce module.
 *
 * Le graphe des imports statiques et dynamiques est parcouru depuis chaque
 * fichier `"use client"` ; le module ne doit jamais y apparaître.
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "hooks", "lib"];
const TARGET = join(ROOT, "lib", "shared", "push-messages.ts");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const IMPORT_RE = /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|jsx?|mjs)$/.test(entry) && !entry.endsWith(".d.ts") ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (existsSync(join(base, `index${ext}`))) return join(base, `index${ext}`);
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    // Un import de type seul n'atteint pas le bundle.
    if (/^(?:import|export)\s+type\s/.test(match[0])) continue;
    const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
    if (target) found.push(target);
  }
  return found;
}

/**
 * Les fichiers qui atteignent le module, chacun avec le suivant sur son chemin :
 * parcours **à rebours** depuis la cible sur le graphe complet — exact, cycles
 * d'imports compris, et chaque entrée client qui fuit est nommée.
 */
function filesReachingTarget(files: readonly string[]): Map<string, string> {
  const importers = new Map<string, string[]>();
  for (const file of files) {
    for (const next of importsOf(file)) importers.set(next, [...(importers.get(next) ?? []), file]);
  }
  const nextHop = new Map<string, string>();
  const queue = [TARGET];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const importer of importers.get(file) ?? []) {
      if (importer === TARGET || nextHop.has(importer)) continue;
      nextHop.set(importer, file);
      queue.push(importer);
    }
  }
  return nextHop;
}

function chainFrom(entry: string, nextHop: ReadonlyMap<string, string>): string {
  const chain = [entry];
  while (chain.at(-1) !== TARGET) chain.push(nextHop.get(chain.at(-1) as string) as string);
  return chain.map((file) => relative(ROOT, file)).join(" → ");
}

describe("push-messages reste côté serveur", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));
  const clientEntries = files.filter((file) =>
    /^\s*["']use client["']/m.test(readFileSync(file, "utf8").slice(0, 400)),
  );

  it("trouve des fichiers client à vérifier", () => {
    expect(clientEntries.length).toBeGreaterThan(50);
  });

  it("aucun module client n'atteint lib/shared/push-messages.ts", () => {
    const nextHop = filesReachingTarget(files);
    const offenders = clientEntries.filter((entry) => nextHop.has(entry)).map((entry) => chainFrom(entry, nextHop));
    expect(offenders).toEqual([]);
  });

  it("le détecteur reconnaît un import du module", () => {
    expect(importsOf(join(ROOT, "lib", "server", "tournaments", "player-pushes.ts"))).toContain(TARGET);
  });

  it("le détecteur suit un détour par un autre module", () => {
    // `match-schedule.ts` ne l'importe pas : il l'atteint par `player-pushes.ts`.
    const nextHop = filesReachingTarget(files);
    const entry = join(ROOT, "lib", "server", "tournaments", "match-schedule.ts");
    expect(importsOf(entry)).not.toContain(TARGET);
    expect(chainFrom(entry, nextHop).split(" → ").length).toBeGreaterThan(2);
  });
});
