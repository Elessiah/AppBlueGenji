import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

/**
 * Revue performance du lot 9-3 : le texte des notifications push existe
 * **dans les deux langues** (`messages/*\/pushMessages.json`), rédigé par
 * `lib/shared/push-messages.ts` (qui embarque aussi les catégories des deux
 * `reports.json`). Tout cela ne sert qu'au serveur ; un seul module client qui
 * l'atteindrait, même par un détour, enverrait l'anglais à toutes les pages
 * françaises qui chargent ce module.
 *
 * Le graphe des imports (statiques, `export … from`, `import()` et `require()`
 * littéraux, lus
 * sur l'arbre syntaxique TypeScript : commentaires et retours à la ligne n'y
 * changent rien, un import de type seul n'y compte pas) est construit une fois, puis parcouru **à rebours** depuis chaque cible : exact,
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

/** Une clause d'import qui n'apporte que des types n'atteint pas le bundle. */
function typeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // `import "x"` : effet de bord, compté
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

/** Un `export { type A } from` (ou `export type { … } from`) n'apporte que des types. */
function typeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

function isModuleLoad(callee: ts.Expression): boolean {
  return callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require");
}

/** Directive de tête : seules d'autres directives la précèdent, quelle que soit la longueur des commentaires. */
function hasUseClient(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function parseSource(path: string, text: string): SourceFile {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  const specifiers: string[] = [];
  let templateImport = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !typeOnlyImport(node)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !typeOnlyExport(node)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      // `import x = require("…")`
      const reference = node.moduleReference.expression;
      if (ts.isStringLiteralLike(reference)) specifiers.push(reference.text);
    } else if (ts.isCallExpression(node) && isModuleLoad(node.expression)) {
      // `import("…")` et `require("…")` : un argument qui n'est pas un littéral ne se suit pas.
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) specifiers.push(argument.text);
      else templateImport = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const imports = specifiers.map((specifier) => resolveImport(path, specifier)).filter((target): target is string => target !== null);
  return { path, client: hasUseClient(source), templateImport, imports };
}

function readSource(path: string): SourceFile {
  return parseSource(path, readFileSync(path, "utf8"));
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

  it("le détecteur lit l'arbre syntaxique : commentaires, retours à la ligne et types seuls", () => {
    const fake = join(ROOT, "components", "fake-client.tsx");
    const text = [
      "/**",
      ...Array.from({ length: 12 }, () => " * l'en-tête d'un composant, assez long pour dépasser quelques lignes."),
      " */",
      '"use client";',
      "export {",
      "  // l'instantané entier",
      "  pushRoundLabel,",
      '} from "@/lib/shared/push-messages";',
      'import type { Locale } from "@/lib/shared/locales";',
      'import { type Leaves } from "@/lib/shared/scoped-text";',
      "const lazy = (x: string) => import(`@/messages/${x}.json`);",
      'export { type RefereeAlertKind } from "@/lib/shared/push-messages";',
      'const en = require("@/messages/en/pushMessages.json");',
      'import fr = require("@/messages/fr/pushMessages.json");',
    ].join("\n");
    const parsed = parseSource(fake, text);
    expect(parsed.client).toBe(true);
    expect(parsed.imports).toEqual([TARGETS[0], TARGETS[1], TARGETS[2]]);
    expect(parsed.templateImport).toBe(true);
    expect(parseSource(fake, 'const a = 1;\n"use client";\n').client).toBe(false);
  });

  it("le détecteur suit un détour par un autre module", () => {
    // `match-schedule.ts` ne l'importe pas : il l'atteint par `player-pushes.ts`.
    const entry = join(ROOT, "lib", "server", "tournaments", "match-schedule.ts");
    expect(byPath.get(entry)?.imports).not.toContain(TARGETS[0]);
    expect(chainFrom(entry, nextHop).split(" → ").length).toBeGreaterThan(2);
  });
});
