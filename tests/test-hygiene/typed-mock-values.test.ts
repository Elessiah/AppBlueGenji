import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "@jest/globals";
import ts from "typescript";
import { readSource } from "../helpers/read-source";

/**
 * **Une valeur simulée est type-vérifiée.**
 *
 * Un `jest.fn()` sans type a pour paramètre de `mockResolvedValue` `never` : la
 * seule façon d'y passer une valeur était `x as never`, qui taisait du même
 * coup tout ce qu'on aurait voulu vérifier — ~1 350 valeurs, dont des `AuthUser`
 * encore porteurs de champs retirés du type et des lignes de tournoi où une
 * colonne absente valait `NaN` et levait par accident une condition
 * d'inscription. Le typecheck ne peut pas refuser un `as never` : il est fait
 * pour passer. D'où ce balayage, qui le refuse là où il n'a plus d'excuse.
 */

const ROOT = join(__dirname, "..", "..");
const TESTS = join(ROOT, "tests");

/** Méthodes dont l'argument devient une valeur rendue par le double. */
const MOCK_VALUE_METHODS =
  /^mock(ResolvedValue|RejectedValue|ReturnValue|Implementation)(Once)?$/;

type Violation = { line: number; text: string };

/** Les `as never` posés à l'intérieur d'un appel `mock*Value` / `mockImplementation`. */
function findNeverMockValues(source: string, fileName = "source.ts"): Violation[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Violation[] = [];
  const visit = (node: ts.Node, insideMock: boolean): void => {
    const opensMock =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MOCK_VALUE_METHODS.test(node.expression.name.text);
    const inside = insideMock || opensMock;
    if (inside && ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.NeverKeyword) {
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        text: node.getText(file).replace(/\s+/g, " "),
      });
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(file, false);
  return found;
}

function testSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__mocks__" ? [] : testSources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("findNeverMockValues", () => {
  it("repère un `as never` passé comme valeur simulée", () => {
    const source = [
      "jest.mocked(fn).mockResolvedValue(user as never);",
      "execute.mockResolvedValueOnce([rows] as never);",
    ].join("\n");
    expect(findNeverMockValues(source).map((v) => v.line)).toEqual([1, 2]);
  });

  it("repère un `as never` rendu par une implémentation simulée", () => {
    const source = "jest.mocked(fn).mockImplementation(async () => ({ row }) as never);";
    expect(findNeverMockValues(source)).toHaveLength(1);
  });

  it("repère un `as never` enfoui dans la valeur, pas seulement à sa racine", () => {
    const source = "jest.mocked(fn).mockResolvedValue({ user: player as never, rows: [] });";
    expect(findNeverMockValues(source)).toEqual([{ line: 1, text: "player as never" }]);
  });

  it("laisse passer les `as never` hors d'une valeur simulée", () => {
    // Une entrée délibérément invalide, ou un double de connexion confronté à
    // la signature d'un `toHaveBeenCalledWith` : ce ne sont pas des valeurs
    // rendues par un mock, le typecheck n'a rien à y vérifier.
    const source = [
      'expect(validate({ format: "TRIPLE" as never })).toBe(false);',
      "expect(flushBotLogs).toHaveBeenCalledWith(connection as never);",
      "jest.mocked(fn).mockResolvedValue(user);",
    ].join("\n");
    expect(findNeverMockValues(source)).toEqual([]);
  });

  it("ne confond pas `jest.mocked` avec une méthode de mock", () => {
    expect(findNeverMockValues("const f = jest.mocked(fn as never);")).toEqual([]);
  });
});

describe("tests/ — aucune valeur simulée en `as never`", () => {
  const files = testSources(TESTS);

  it("balaie bien les fichiers de test", () => {
    // Garde du balayage lui-même : un chemin faux rendrait une liste vide, et
    // l'assertion suivante passerait sur rien.
    expect(files.length).toBeGreaterThan(300);
  });

  it("ne laisse aucun `as never` dans un `mock*Value` ni un `mockImplementation`", () => {
    const violations = files.flatMap((path) =>
      findNeverMockValues(readSource(path), path).map(
        (v) => `${relative(ROOT, path).replace(/\\/g, "/")}:${v.line} — ${v.text}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
