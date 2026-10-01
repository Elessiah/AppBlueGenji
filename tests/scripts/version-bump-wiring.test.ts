import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Le bump de version à la fusion (docs/features/VERSIONING.md).
 *
 * Le workflow ne s'exécute que sur GitHub : aucune erreur de câblage ne se
 * verrait avant la première fusion, et un oubli (déclencheur, étiquette de
 * saut, garde anti-boucle) produirait soit aucune version, soit une version
 * par commit de version. Ces cas tiennent les points qui le rendent sûr.
 */

const workflow = readSource(".github/workflows/version-bump.yml");

describe("workflow de bump de version", () => {
  it("ne se déclenche qu'à la fusion d'une PR dans main", () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*types: \[closed\]\s*\n\s*branches: \[main\]/);
    expect(workflow).toContain("github.event.pull_request.merged == true");
  });

  it("respecte release:skip et ne boucle pas sur ses propres commits", () => {
    expect(workflow).toContain("!contains(github.event.pull_request.labels.*.name, 'release:skip')");
    expect(workflow).toContain("!startsWith(github.event.pull_request.head.ref, 'release/')");
    expect(workflow).toContain("github.event.pull_request.user.login != 'github-actions[bot]'");
    expect(workflow).toContain('git commit -m "release $VERSION [skip ci]"');
  });

  it("lit le niveau sur les étiquettes major puis minor, patch par défaut", () => {
    expect(workflow).toContain("contains(github.event.pull_request.labels.*.name, 'release:major')");
    expect(workflow).toContain("contains(github.event.pull_request.labels.*.name, 'release:minor')");
    expect(workflow).toMatch(/IS_MAJOR[\s\S]*level=major[\s\S]*IS_MINOR[\s\S]*level=minor[\s\S]*else level=patch/);
  });

  it("sérialise les exécutions sans les annuler", () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s*group: version-bump\s*\n\s*cancel-in-progress: false/);
  });

  it("part de main à jour, pas du commit de fusion", () => {
    expect(workflow).toMatch(/ref: main\s*\n\s*fetch-depth: 0/);
    expect(workflow).toContain("npm version \"${{ steps.level.outputs.level }}\" --no-git-tag-version");
  });

  it("publie un tag et une release, avec un jeton de repli", () => {
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("secrets.RELEASE_TOKEN || github.token");
    expect(workflow).toContain('gh release create "$VERSION"');
    expect(workflow).toContain("--generate-notes");
  });

  it("épingle les actions sur les mêmes versions majeures que le CI", () => {
    const ci = readSource(".github/workflows/ci.yml");
    for (const action of workflow.match(/uses: \S+/g) ?? []) {
      expect(ci).toContain(action);
    }
  });
});

describe("version du paquet", () => {
  it("est en SemVer et identique dans package.json et package-lock.json", () => {
    const pkg = JSON.parse(readSource("package.json")) as { version: string };
    const lock = JSON.parse(readSource("package-lock.json")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""]?.version).toBe(pkg.version);
  });
});
