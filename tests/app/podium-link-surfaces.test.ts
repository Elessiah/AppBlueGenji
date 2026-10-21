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

/** Classes dont une règle propre (sélecteur = `.classe`) pose un fond. */
function surfaceClasses(css: string): Set<string> {
  const surfaces = new Set<string>();
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!PAINT.test(body)) continue;
    for (const selector of selectors.split(",")) {
      const single = /^\.([\w-]+)$/.exec(selector.trim());
      if (single && !single[1].startsWith("podium-")) surfaces.add(single[1]);
    }
  }
  return surfaces;
}

const GLOBAL_SURFACES = surfaceClasses(readFileSync(join(ROOT, "app", "globals.css"), "utf8"));

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Modules CSS importés (`import styles from "./x.module.css"`) : identifiant → classes peintes. */
function moduleSurfaces(file: ts.SourceFile, path: string | undefined): Map<string, Set<string>> {
  const modules = new Map<string, Set<string>>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const name = statement.importClause?.name?.text;
    const specifier = statement.moduleSpecifier.text;
    if (!name || !specifier.endsWith(".module.css")) continue;
    const cssPath = specifier.startsWith("@/") ? join(ROOT, specifier.slice(2)) : path && join(dirname(path), specifier);
    modules.set(name, cssPath && existsSync(cssPath) ? surfaceClasses(readFileSync(cssPath, "utf8")) : new Set());
  }
  return modules;
}

/** Classes nommées par une expression de classe : littéraux, gabarits, appels (`cn(...)`), `styles.x`. */
function classesOf(node: ts.Node, modules: Map<string, Set<string>>): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.split(/\s+/);
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      .flatMap((text) => text.split(/\s+/))
      .concat(node.templateSpans.flatMap((span) => classesOf(span.expression, modules)));
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const painted = modules.get(node.expression.text);
    return painted?.has(node.name.text) ? [`${node.expression.text}.${node.name.text}`] : [];
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && ts.isStringLiteral(node.argumentExpression)) {
    const painted = modules.get(node.expression.text);
    return painted?.has(node.argumentExpression.text) ? [`${node.expression.text}.${node.argumentExpression.text}`] : [];
  }
  const nested: string[] = [];
  ts.forEachChild(node, (child) => {
    nested.push(...classesOf(child, modules));
  });
  return nested;
}

/** Liens d'entité dont la classe porte une surface peinte. */
function paintedLinks(code: string, path?: string): string[] {
  const file = ts.createSourceFile(path ?? "inline.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const modules = moduleSurfaces(file, path);
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    const paintedAttribute = opening && TIER_LINKS.get(opening.tagName.getText(file));
    if (opening && paintedAttribute) {
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(file) !== paintedAttribute || !attribute.initializer) continue;
        const painted = classesOf(attribute.initializer, modules).filter(
          (name) => name.includes(".") || GLOBAL_SURFACES.has(name),
        );
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

  it("résout les classes d'un module CSS importé", () => {
    const path = join(ROOT, "app", "(secured)", "tournois", "[id]", "_components", "EntrantName.tsx");
    const code = (className: string) => `import styles from "./EntrantName.module.css";\n<TeamLink teamId={1} className={${className}} />`;
    expect(paintedLinks(code("styles.logo"), path)).toEqual(["<TeamLink> styles.logo"]);
    expect(paintedLinks(code(`styles["logo"]`), path)).toHaveLength(1);
    expect(paintedLinks(code("styles.logoImage"), path)).toEqual([]);
  });

  it("laisse passer une pastille posée sur un conteneur", () => {
    expect(paintedLinks(`<span className="badge"><TeamLink teamId={1}>X</TeamLink></span>`)).toEqual([]);
    expect(paintedLinks(`<TeamLink teamId={1} className="badge-like">X</TeamLink>`)).toEqual([]);
  });

  it("aucun écran ne pose une surface sur le lien lui-même (classes globales et modules)", () => {
    const offenders = [...sources("app"), ...sources("components")].flatMap((path) =>
      paintedLinks(readFileSync(path, "utf8"), path).map((tag) => `${relative(ROOT, path)}: ${tag}`),
    );
    expect(offenders).toEqual([]);
  });
});
