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
    expect(pkg.scripts.typecheck).toMatch(/--noEmit -p tsconfig\.typecheck\.json$/);
  });

  it("désigne son compilateur par chemin, jamais par le binaire `tsc`", () => {
    // TypeScript 5 (`typescript`, lu par Next, ts-jest et ESLint) et 7
    // (`typescript-native`) fournissent tous deux un binaire `tsc` : celui que
    // `node_modules/.bin` retient dépend de l'ordre d'installation.
    const pkg = json("package.json") as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toMatch(/^node node_modules\/typescript-native\/bin\/tsc /);
    expect(pkg.scripts["typecheck:ts5"]).toMatch(/^node node_modules\/typescript\/bin\/tsc /);
  });

  it("installe TypeScript 7 à côté de TypeScript 5, sans le remplacer", () => {
    // Next, ts-jest et typescript-eslint chargent `typescript` et refusent la
    // version 7 : seul le contrôle des types passe par l'alias.
    const pkg = json("package.json") as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.typescript).toMatch(/^\^5/);
    expect(pkg.devDependencies["typescript-native"]).toMatch(/^npm:typescript@\^7/);
  });

  it("lit les imports de feuilles globales pareil en TypeScript 5 et 7", () => {
    // Défaut de TypeScript 6+ : `import "./globals.css"` serait refusé, Next
    // ne déclarant que les `*.module.css`. Posé explicitement, le réglage ne
    // dépend plus de la version qui lit le fichier.
    const options = json("tsconfig.json").compilerOptions as Record<string, unknown>;
    expect(options.noUncheckedSideEffectImports).toBe(false);
  });

  it("ne pose dans `tsconfig.jest.json` aucune résolution retirée de TypeScript 7", () => {
    const options = json("tsconfig.jest.json").compilerOptions as Record<string, unknown>;
    expect(options.moduleResolution).toBeUndefined();
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
