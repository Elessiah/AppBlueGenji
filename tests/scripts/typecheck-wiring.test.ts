import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Les tests sont type-vérifiés — et ce contrôle est branché au CI.
 *
 * `tsconfig.json` exclut `tests/` et ts-jest ne fait que transpiler
 * (`isolatedModules`) : un `const x: number = "nope"` dans un test passait au
 * vert. Un millier d'erreurs s'y étaient accumulées sans que rien ne le dise —
 * fixtures périmées que le type du jour refusait, et contrats exprimés au type
 * (`@ts-expect-error`, `Parameters<typeof X>`) qui ne vérifiaient rien.
 *
 * Ces cas tiennent le câblage : une configuration qui couvre `tests/`, un
 * script qui l'utilise, et une étape du CI qui lance le script. Retirer l'un
 * des trois rendrait le contrôle muet, exactement comme avant.
 */

/** JSON du dépôt, commentaires de ligne retirés (tsconfig en admet). */
function json(path: string): Record<string, unknown> {
  return JSON.parse(readSource(path).replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

describe("type-vérification des tests", () => {
  const config = json("tsconfig.typecheck.json");

  it("hérite de la configuration de l'application", () => {
    // Mêmes options strictes, même alias `@/*` : un test ne doit pas être jugé
    // plus mollement que le code qu'il exerce.
    expect(config.extends).toBe("./tsconfig.json");
  });

  it("couvre l'application **et** `tests/`, en un seul programme", () => {
    // Un seul passage : un programme pour l'application puis un second pour
    // les tests revérifiaient toute l'application, que les tests importent.
    expect(config.include).toEqual(expect.arrayContaining(["**/*.ts", "**/*.tsx"]));
    // `exclude` doit être redéfini : hérité de `tsconfig.json`, il retirerait
    // `tests` de ce qu'`include` vient d'y mettre.
    expect(config.exclude).toBeDefined();
    expect(config.exclude).not.toContain("tests");
  });

  it("est lancée par `npm run typecheck`", () => {
    const pkg = json("package.json") as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.typecheck.json");
  });

  it("est jouée par le CI", () => {
    expect(readSource(".github/workflows/ci.yml")).toMatch(/run: npm run typecheck/);
  });

  it("ne laisse pas `tsconfig.jest.json` prétendre couvrir les tests", () => {
    // Son `include: ["tests", …]` était annulé par l'`exclude` hérité : un
    // `tsc -p tsconfig.jest.json` passait au vert sans lire un seul test.
    expect(json("tsconfig.jest.json").include).toBeUndefined();
  });
});
