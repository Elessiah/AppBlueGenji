import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Le CI rapide (docs/features/CI.md) : tri des jobs par fichiers modifiés,
 * caches et suppression des doublons.
 *
 * Le tri décide de ce qui **ne** tourne **pas** : une erreur y laisse passer au
 * vert une PR que personne n'a vérifiée. D'où les cas d'incertitude, qui
 * doivent tous jouer l'ensemble.
 */

type Jobs = { lint: boolean; build: boolean; e2e: boolean };
const SCRIPT = join(__dirname, "..", "..", "scripts", "ci-changed-jobs.cjs");
const { classifyChangedFiles, formatOutputs, API_FILE_LIMIT } = require(SCRIPT) as {
  classifyChangedFiles: (files: readonly string[]) => Jobs;
  formatOutputs: (jobs: Jobs) => string;
  API_FILE_LIMIT: number;
};

const ALL: Jobs = { lint: true, build: true, e2e: true };
const NONE: Jobs = { lint: false, build: false, e2e: false };

describe("classifyChangedFiles", () => {
  it("joue tout pour un composant de l'application", () => {
    expect(classifyChangedFiles(["components/ui/toast.tsx"])).toEqual(ALL);
  });

  it("joue lint, build et E2E pour une traduction (JSON importé par l'application)", () => {
    expect(classifyChangedFiles(["messages/en.json"])).toEqual(ALL);
  });

  it("ne joue ni build ni E2E pour un test Jest seul", () => {
    expect(classifyChangedFiles(["tests/lib/shared/foo.test.ts"])).toEqual({ lint: true, build: false, e2e: false });
  });

  it("joue l'E2E sans build pour un scénario Playwright", () => {
    expect(classifyChangedFiles(["e2e/auth.spec.ts"])).toEqual({ lint: true, build: false, e2e: true });
    expect(classifyChangedFiles(["e2e/README.md"])).toEqual({ lint: false, build: false, e2e: true });
  });

  it("ne joue que les tests pour de la documentation", () => {
    expect(classifyChangedFiles(["docs/features/CI.md", "ERREUR.txt", "CLAUDE.md"])).toEqual(NONE);
  });

  it("joue build et E2E sans lint pour une feuille de style ou une image", () => {
    expect(classifyChangedFiles(["app/globals.css"])).toEqual({ lint: false, build: true, e2e: true });
    expect(classifyChangedFiles(["public/logo.png"])).toEqual({ lint: false, build: true, e2e: true });
  });

  it("lint une règle ESLint maison", () => {
    expect(classifyChangedFiles(["eslint-rules/no-literal-ui-text.cjs"]).lint).toBe(true);
  });

  it.each([
    [".github/workflows/ci.yml"],
    [".github/actions/setup/action.yml"],
    ["package.json"],
    ["package-lock.json"],
  ])("joue tout quand %s change", (file) => {
    expect(classifyChangedFiles(["docs/x.md", file])).toEqual(ALL);
  });

  it("joue tout sur une liste vide (rien n'a pu être lu)", () => {
    expect(classifyChangedFiles([])).toEqual(ALL);
    expect(classifyChangedFiles(["", "  "])).toEqual(ALL);
  });

  it("joue tout au plafond de l'API, la liste pouvant être tronquée", () => {
    const docs = Array.from({ length: API_FILE_LIMIT }, (_, i) => `docs/f${i}.md`);
    expect(classifyChangedFiles(docs)).toEqual(ALL);
    expect(classifyChangedFiles(docs.slice(1))).toEqual(NONE);
  });

  it("ignore les blancs et retours chariot autour des chemins", () => {
    expect(classifyChangedFiles(["docs/a.md\r", " lib/x.ts "])).toEqual(ALL);
  });

  it("ne confond pas un chemin voisin avec un dossier compilé", () => {
    expect(classifyChangedFiles(["docs/app/notes.md", "scripts/lib.sh"])).toEqual(NONE);
  });
});

describe("script en ligne de commande", () => {
  it("écrit les sorties au format de $GITHUB_OUTPUT", () => {
    expect(formatOutputs({ lint: true, build: false, e2e: true })).toBe("lint=true\nbuild=false\ne2e=true\n");
  });

  it("lit les chemins sur l'entrée standard", () => {
    const out = execFileSync(process.execPath, [SCRIPT], { input: "tests/a.test.ts\ndocs/b.md\n", encoding: "utf8" });
    expect(out).toBe("lint=true\nbuild=false\ne2e=false\n");
  });
});

describe("workflow CI", () => {
  const ci = readSource(".github/workflows/ci.yml");
  const setup = readSource(".github/actions/setup/action.yml");

  it("annule l'exécution précédente d'une même PR", () => {
    expect(ci).toMatch(/concurrency:\n\s+group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n\s+cancel-in-progress: true/);
  });

  it("branche chaque job conditionnel sur la sortie du tri", () => {
    for (const job of ["lint", "build", "e2e"]) {
      expect(ci).toContain(`if: needs.changes.outputs.${job} == 'true'`);
    }
    expect(ci).toContain("node scripts/ci-changed-jobs.cjs");
  });

  it("joue tout si la liste des fichiers est illisible", () => {
    expect(ci).toMatch(/elif ! files=\$\(gh api --paginate[\s\S]+?files="\.github\/workflows\/ci\.yml"/);
  });

  it("ne rejoue pas ESLint dans le build", () => {
    expect(ci).toContain("run: npm run build -- --no-lint");
  });

  it("met ESLint en cache par contenu, pas par date", () => {
    expect(ci).toContain("run: npm run lint -- --cache-strategy content");
    expect(ci).toContain("path: .next/cache/eslint");
  });

  it("répartit les tests sur deux machines, sans arrêter l'autre moitié à la première erreur", () => {
    expect(ci).toContain("fail-fast: false");
    expect(ci).toContain("--shard=${{ matrix.shard }}/2");
  });

  it("remplit les caches depuis main, hors poussée de documentation", () => {
    expect(ci).toMatch(/push:\n\s+branches: \[main\]\n\s+paths-ignore:/);
    expect(ci).toContain("lookup-only: ${{ github.event_name != 'pull_request' }}");
    expect(ci).toContain("if: github.event_name == 'pull_request'\n        run: npm run test:e2e");
  });

  it("indexe node_modules sur le verrou et n'installe qu'en cas d'absence", () => {
    expect(setup).toContain("path: node_modules");
    expect(setup).toContain("hashFiles('package-lock.json')");
    expect(setup).toContain("if: steps.node-modules.outputs.cache-hit != 'true'");
    expect(setup).toContain("run: npm ci --ignore-scripts");
  });

  it("borne la durée de chaque job", () => {
    const jobs = ci.split("\njobs:\n")[1] ?? "";
    const declared = jobs.match(/^ {2}[a-z0-9-]+:$/gm) ?? [];
    const timeouts = jobs.match(/^ {4}timeout-minutes: \d+$/gm) ?? [];
    expect(declared.length).toBeGreaterThan(0);
    expect(timeouts).toHaveLength(declared.length);
  });
});
