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
  it("se déclenche au push sur main, sans déclencheur privilégié", () => {
    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*branches: \[main\]/);
    expect(workflow).not.toMatch(/^\s*pull_request(_target)?:/m);
  });

  it("ne bump que pour une PR fusionnée dans main, retrouvée par l'API", () => {
    expect(workflow).toContain('gh api "repos/$GITHUB_REPOSITORY/commits/$MERGE_SHA/pulls"');
    expect(workflow).toContain('select(.merged_at != null and .base.ref == "main")');
    // Chaque étape utile attend que la PR ait été retrouvée et non exclue.
    const guarded = workflow.match(/if: steps\.pr\.outputs\.skip == 'false'/g) ?? [];
    expect(guarded).toHaveLength(4);
  });

  it("respecte release:skip et ne boucle pas sur ses propres commits", () => {
    expect(workflow).toContain('*",release:skip,"*) skip=true');
    expect(workflow).toContain("release/*) skip=true");
    expect(workflow).toContain('if [ "$author" = "github-actions[bot]" ]; then skip=true; fi');
    expect(workflow).toContain('marker="(#$PR_NUMBER) [skip ci]"');
    expect(workflow).toContain('git commit -q -m "release $version $marker"');
  });

  it("lit le niveau sur les étiquettes major puis minor, patch par défaut", () => {
    expect(workflow).toMatch(
      /",release:major,"[\s\S]*level=major[\s\S]*",release:minor,"[\s\S]*level=minor[\s\S]*else level=patch/,
    );
  });

  it("ne met aucune fusion en file commune, où GitHub annulerait les attentes", () => {
    expect(workflow).toMatch(
      /group: version-bump-\$\{\{ inputs\.sha \|\| github\.sha \}\}\s*\n\s*cancel-in-progress: false/,
    );
  });

  it("se rattrape à la main quand un [skip ci] de squash a sauté le push", () => {
    expect(workflow).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*sha:/);
    expect(workflow).toContain("MERGE_SHA: ${{ inputs.sha || github.sha }}");
    expect(workflow).toContain('[[ ! "$MERGE_SHA" =~ ^[0-9a-f]{7,40}$ ]]');
  });

  it("pousse commit et tag ensemble, recalculés sur main à chaque essai", () => {
    expect(workflow).toContain("git reset -q --hard origin/main");
    expect(workflow).toContain('git push --atomic origin HEAD:main "refs/tags/$version"');
  });

  it("reprend la version déjà posée pour la PR au lieu d'en monter une seconde", () => {
    expect(workflow).toContain('--fixed-strings --grep="$marker" origin/main');
    expect(workflow).toContain('gh release view "$VERSION"');
  });

  it("part de main à jour, pas du commit de fusion", () => {
    expect(workflow).toMatch(/ref: main\s*\n\s*fetch-depth: 0/);
    expect(workflow).toContain('npm version "$LEVEL" --no-git-tag-version');
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
