import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as ts from "typescript";

/**
 * Un lien d'entité peut porter une marche du podium : son nom est alors peint
 * par `background-clip: text` dans un texte transparent (`PODIUM_TIERS.md`).
 * Une classe qui pose un fond sur le **même** élément (une pastille `.badge`,
 * `.pill`, `.cy-tag`, une classe de module…) efface ce dégradé : le nom
 * disparaît, et ne revient qu'au survol. La pastille habille donc un conteneur,
 * jamais le lien lui-même.
 *
 * Les sources sont lues par le compilateur TypeScript (aucune expression
 * régulière sur du JSX) ; une classe est une « surface » si une règle de
 * `app/globals.css` — ou du module CSS importé — dont le sélecteur est cette
 * classe seule pose `background`, `background-image` ou `background-clip`.
 */

const ROOT = join(__dirname, "..", "..");
/**
 * Composants qui posent une marche du podium, et l'attribut dont la classe
 * atterrit sur l'élément peint (`EntrantName` : `className` habille le
 * conteneur emblème + nom, `textClassName` le lien).
 */
const TIER_LINKS = new Map([
  ["TeamLink", "className"],
  ["PlayerLink", "className"],
  ["EntrantLink", "className"],
  ["EntrantName", "textClassName"],
]);
const PAINT = /(?:^|;)\s*background(?:-image|-clip)?\s*:/;

/** Découpe une liste de sélecteurs aux virgules de premier niveau (pas dans `:is(.a, .b)`). */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  return [...parts, current];
}

/**
 * Classes d'une règle qui pose un fond sur l'élément qu'elle vise : toute
 * classe du dernier sélecteur composé (`.badge`, `.badge:hover`,
 * `.pill.pill-blue`, `.row .chip`), hors pseudo-classes fonctionnelles
 * (`:not(.ghost)` ne peint pas `.ghost`). Commentaires et at-rules sans bloc
 * (`@import …;`) sont retirés avant la lecture ; les règles propres à la
 * marche (`.entity-link.podium-tier:hover`…) sont écartées.
 */
function surfaceClasses(css: string): Set<string> {
  const surfaces = new Set<string>();
  const cleaned = css.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/@[^;{}]*;/g, "");
  for (const [, selectors, body] of cleaned.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!PAINT.test(body)) continue;
    for (const selector of splitSelectors(selectors)) {
      let bare = selector.trim();
      // Pseudo-classes fonctionnelles, imbriquées comprises : retirées de l'intérieur vers l'extérieur.
      while (/:[\w-]+\([^()]*\)/.test(bare)) bare = bare.replaceAll(/:[\w-]+\([^()]*\)/g, "");
      const target = bare.split(/\s*[\s>+~]\s*/).at(-1) ?? "";
      // Les règles de la marche elle-même (survol, ligne en retrait) ne sont pas des surfaces.
      if (target.includes(".podium-")) continue;
      for (const [, name] of target.matchAll(/\.([\w-]+)/g)) surfaces.add(name);
    }
  }
  return surfaces;
}

function sources(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Feuilles globales (tout `.css` hors module) de `app/` et `components/`. */
const GLOBAL_SHEETS = ["app", "components"].flatMap((dir) =>
  sources(dir, (name) => name.endsWith(".css") && !name.endsWith(".module.css")),
);
const GLOBAL_SURFACES = new Set(GLOBAL_SHEETS.flatMap((path) => [...surfaceClasses(readFileSync(path, "utf8"))]));
const tsx = (name: string) => name.endsWith(".tsx");

/** Modules CSS importés (`import styles from "./x.module.css"`) : identifiant → classes peintes. */
function moduleSurfaces(file: ts.SourceFile, path: string | undefined): Map<string, Set<string>> {
  const modules = new Map<string, Set<string>>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const name =
      statement.importClause?.name?.text ?? (bindings && ts.isNamespaceImport(bindings) ? bindings.name.text : undefined);
    const specifier = statement.moduleSpecifier.text;
    if (!name || !specifier.endsWith(".module.css")) continue;
    const cssPath = specifier.startsWith("@/") ? join(ROOT, specifier.slice(2)) : path && join(dirname(path), specifier);
    modules.set(name, cssPath && existsSync(cssPath) ? surfaceClasses(readFileSync(cssPath, "utf8")) : new Set());
  }
  return modules;
}

/** Classes nommées par une expression de classe : littéraux, gabarits, appels (`cn(...)`), `styles.x`. */
interface Named {
  /** Classes globales écrites en toutes lettres. */
  global: string[];
  /** Classes de module CSS qui posent un fond (`styles.x`). */
  painted: string[];
}

function classesOf(node: ts.Node, modules: Map<string, Set<string>>, named: Named = { global: [], painted: [] }): Named {
  const moduleClass = (holder: ts.Expression, name: string) => {
    if (ts.isIdentifier(holder) && modules.get(holder.text)?.has(name)) named.painted.push(`${holder.text}.${name}`);
  };
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    named.global.push(...node.text.split(/\s+/));
  } else if (ts.isTemplateExpression(node)) {
    for (const text of [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]) named.global.push(...text.split(/\s+/));
    for (const span of node.templateSpans) classesOf(span.expression, modules, named);
  } else if (ts.isPropertyAccessExpression(node)) {
    moduleClass(node.expression, node.name.text);
  } else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    moduleClass(node.expression, node.argumentExpression.text);
  } else {
    ts.forEachChild(node, (child) => {
      classesOf(child, modules, named);
    });
  }
  return named;
}

/** Liens d'entité dont la classe porte une surface peinte. */
function paintedLinks(code: string, path?: string): string[] {
  const file = ts.createSourceFile(path ?? "inline.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const modules = moduleSurfaces(file, path);
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    const paintedAttribute = opening && TIER_LINKS.get(opening.tagName.getText(file));
    // `podiumTier={null}` : lien sans marche (lien-avatar du roster, par exemple).
    const tierless = opening?.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(file) === "podiumTier" &&
        attribute.initializer !== undefined &&
        ts.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression?.kind === ts.SyntaxKind.NullKeyword,
    );
    if (opening && paintedAttribute && !tierless) {
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(file) !== paintedAttribute || !attribute.initializer) continue;
        const named = classesOf(attribute.initializer, modules);
        const painted = [...named.global.filter((name) => GLOBAL_SURFACES.has(name)), ...named.painted];
        if (painted.length > 0) offenders.push(`<${opening.tagName.getText(file)}> ${painted.join(" ")}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offenders;
}

describe("lien d'entité et marche du podium", () => {
  it("tire les surfaces de la feuille globale (pastilles, étiquettes)", () => {
    for (const name of ["badge", "pill", "pill-blue", "cy-tag"]) expect(GLOBAL_SURFACES).toContain(name);
    expect(GLOBAL_SURFACES).not.toContain("entity-link");
    expect(GLOBAL_SURFACES).not.toContain("podium-tier");
  });

  it("repère un lien habillé en pastille, quelle que soit l'écriture de la classe", () => {
    expect(paintedLinks(`<TeamLink teamId={1} className="badge">X</TeamLink>`)).toHaveLength(1);
    expect(paintedLinks("<PlayerLink userId={1} className={`pill ${x}`}>X</PlayerLink>")).toHaveLength(1);
    expect(paintedLinks(`<TeamLink teamId={1} className={"badge"} />`)).toHaveLength(1);
    expect(paintedLinks(`<TeamLink teamId={1} className={cn("cy-tag", active && "x")} />`)).toHaveLength(1);
    expect(paintedLinks(`<EntrantName teamId={1} name="X" textClassName="badge" />`)).toHaveLength(1);
    // Chez `EntrantName`, `className` habille le conteneur, pas le lien.
    expect(paintedLinks(`<EntrantName teamId={1} name="X" className="badge" />`)).toEqual([]);
  });

  it("lit la balise entière, flèches et comparaisons comprises", () => {
    expect(paintedLinks(`<TeamLink teamId={1} onClick={() => track(a > b)} className="badge">X</TeamLink>`)).toHaveLength(1);
  });

  it("compte les surfaces des sélecteurs composés, survol compris, et passe les at-rules", () => {
    const surfaces = surfaceClasses(
      `@import url("x.css");\n.chip { background: red; }\n.tag:hover { background-image: none; }\n.row .cell.on { background: red; }\n.chip-text { color: red; }`,
    );
    expect([...surfaces].sort((a, b) => a.localeCompare(b))).toEqual(["cell", "chip", "on", "tag"]);
  });

  it("ignore les classes des pseudo-classes fonctionnelles et ne coupe pas `:is(.a, .b)`", () => {
    const surfaces = surfaceClasses(`.btn:not(.ghost) { background: red; }\n.card:is(.a, .b), .chip { background: red; }`);
    expect([...surfaces].sort((a, b) => a.localeCompare(b))).toEqual(["btn", "card", "chip"]);
  });

  it("lit toutes les feuilles globales, pas seulement globals.css", () => {
    expect(GLOBAL_SHEETS.map((path) => relative(ROOT, path).replaceAll("\\", "/")).sort((a, b) => a.localeCompare(b))).toEqual(
      expect.arrayContaining(["app/bot/bot.css", "app/bot/docs/docs.css", "app/globals.css"]),
    );
  });

  it("ne prend pas pour une classe de module une chaîne qui contient un point", () => {
    expect(paintedLinks(`<TeamLink teamId={1} className={cn("x", t("a.b"))} />`)).toEqual([]);
    expect(paintedLinks(`<TeamLink teamId={1} className="v1.2" />`)).toEqual([]);
  });

  it("résout les classes d'un module CSS importé", () => {
    const path = join(ROOT, "app", "(secured)", "tournois", "[id]", "_components", "EntrantName.tsx");
    const code = (className: string) => `import styles from "./EntrantName.module.css";\n<TeamLink teamId={1} className={${className}} />`;
    expect(paintedLinks(code("styles.logo"), path)).toEqual(["<TeamLink> styles.logo"]);
    expect(paintedLinks(code(`styles["logo"]`), path)).toHaveLength(1);
    expect(paintedLinks(code("styles.logoImage"), path)).toEqual([]);
    const namespaced = `import * as styles from "./EntrantName.module.css";\n<TeamLink teamId={1} className={styles.logo} />`;
    expect(paintedLinks(namespaced, path)).toHaveLength(1);
  });

  it("laisse passer une pastille posée sur un conteneur, ou un lien sans marche", () => {
    expect(paintedLinks(`<PlayerLink userId={1} className="badge" podiumTier={null} />`)).toEqual([]);
    expect(paintedLinks(`<PlayerLink userId={1} className="badge" podiumTier={deleted ? null : undefined} />`)).toHaveLength(1);
    expect(paintedLinks(`<span className="badge"><TeamLink teamId={1}>X</TeamLink></span>`)).toEqual([]);
    expect(paintedLinks(`<TeamLink teamId={1} className="badge-like">X</TeamLink>`)).toEqual([]);
  });

  it("aucun écran ne pose une surface sur le lien lui-même (classes globales et modules)", () => {
    const offenders = [...sources("app", tsx), ...sources("components", tsx)].flatMap((path) =>
      paintedLinks(readFileSync(path, "utf8"), path).map((tag) => `${relative(ROOT, path)}: ${tag}`),
    );
    expect(offenders).toEqual([]);
  });
});
