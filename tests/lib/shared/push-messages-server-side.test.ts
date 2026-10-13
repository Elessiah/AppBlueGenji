import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Revue performance du lot 9-3 : le texte des notifications push existe
 * **dans les deux langues** (`messages/*\/pushMessages.json`), rédigé par
 * `lib/shared/push-messages.ts` (qui embarque aussi les catégories des deux
 * `reports.json`). Tout cela ne sert qu'au serveur ; un seul module client qui
 * l'atteindrait, même par un détour, enverrait l'anglais à toutes les pages
 * françaises qui chargent ce module.
 *
 * Le graphe des imports (statiques, `export … from`, `import()` littéraux) est
 * construit une fois, puis parcouru **à rebours** depuis chaque cible : exact,
 * cycles compris, et chaque entrée `"use client"` qui fuit est nommée avec son
 * chemin. Un `import()` à gabarit (`` import(`@/messages/${x}.json`) ``) ne se
 * résout pas : il est refusé dans tout module atteint par le client.
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib"];
const TARGETS = [
  join(ROOT, "lib", "shared", "push-messages.ts"),
  join(ROOT, "messages", "en", "pushMessages.json"),
  join(ROOT, "messages", "fr", "pushMessages.json"),
];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const IMPORT_RE = /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const TEMPLATE_IMPORT_RE = /import\s*\(\s*`/;

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

type SourceFile = { path: string; client: boolean; templateImport: boolean; imports: string[] };

function readSource(path: string): SourceFile {
  const source = readFileSync(path, "utf8");
  const imports: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    // Un import de type seul n'atteint pas le bundle.
    if (/^(?:import|export)\s+type\s/.test(match[0])) continue;
    const target = resolveImport(path, match[1] ?? match[2] ?? match[3]);
    if (target) imports.push(target);
  }
  return {
    path,
    client: /^\s*["']use client["']/m.test(source.slice(0, 400)),
    templateImport: TEMPLATE_IMPORT_RE.test(source),
    imports,
  };
}

/** Pour chaque fichier qui atteint une cible : le suivant sur son chemin. */
function nextHopsTo(targets: readonly string[], files: readonly SourceFile[]): Map<string, string> {
  const importers = new Map<string, string[]>();
  for (const file of files) {
    for (const next of file.imports) {
      const list = importers.get(next);
      if (list) list.push(file.path);
      else importers.set(next, [file.path]);
    }
  }
  const nextHop = new Map<string, string>();
  const queue = [...targets];
  for (let index = 0; index < queue.length; index += 1) {
    for (const importer of importers.get(queue[index]) ?? []) {
      if (targets.includes(importer) || nextHop.has(importer)) continue;
      nextHop.set(importer, queue[index]);
      queue.push(importer);
    }
  }
  return nextHop;
}

/** Tout ce qu'un ensemble d'entrées atteint (elles comprises). */
function reachableFrom(entries: readonly SourceFile[], byPath: ReadonlyMap<string, SourceFile>): SourceFile[] {
  const seen = new Set(entries.map((entry) => entry.path));
  const queue = [...entries];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of queue[index].imports) {
      const file = byPath.get(next);
      if (file && !seen.has(next)) {
        seen.add(next);
        queue.push(file);
      }
    }
  }
  return queue;
}

function chainFrom(entry: string, nextHop: ReadonlyMap<string, string>): string {
  const chain = [entry];
  for (let hop = nextHop.get(entry); hop !== undefined; hop = nextHop.get(hop)) chain.push(hop);
  return chain.map((file) => relative(ROOT, file)).join(" → ");
}

describe("le texte des notifications push reste côté serveur", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map(readSource);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const clientEntries = files.filter((file) => file.client);
  const nextHop = nextHopsTo(TARGETS, files);

  it("trouve des fichiers client à vérifier", () => {
    expect(clientEntries.length).toBeGreaterThan(50);
  });

  it("aucun module client n'atteint push-messages.ts ni pushMessages.json", () => {
    const offenders = clientEntries.filter((entry) => nextHop.has(entry.path)).map((entry) => chainFrom(entry.path, nextHop));
    expect(offenders).toEqual([]);
  });

  it("aucun module atteint par le client ne charge un import() à gabarit, que ce garde ne saurait suivre", () => {
    const unresolvable = reachableFrom(clientEntries, byPath)
      .filter((file) => file.templateImport)
      .map((file) => relative(ROOT, file.path));
    expect(unresolvable).toEqual([]);
  });

  it("le détecteur reconnaît un import du module", () => {
    expect(byPath.get(join(ROOT, "lib", "server", "tournaments", "player-pushes.ts"))?.imports).toContain(TARGETS[0]);
    expect(byPath.get(TARGETS[0])?.imports).toEqual(expect.arrayContaining([TARGETS[1], TARGETS[2]]));
  });

  it("le détecteur suit un détour par un autre module", () => {
    // `match-schedule.ts` ne l'importe pas : il l'atteint par `player-pushes.ts`.
    const entry = join(ROOT, "lib", "server", "tournaments", "match-schedule.ts");
    expect(byPath.get(entry)?.imports).not.toContain(TARGETS[0]);
    expect(chainFrom(entry, nextHop).split(" → ").length).toBeGreaterThan(2);
  });
});
