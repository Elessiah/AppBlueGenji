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
const { classifyChangedFiles, decodeLine, formatOutputs, API_FILE_LIMIT } = require(SCRIPT) as {
  classifyChangedFiles: (files: readonly string[]) => Jobs;
  decodeLine: (line: string) => string;
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

  it("joue l'E2E sans build pour un fichier non compilé du dossier e2e", () => {
    expect(classifyChangedFiles(["e2e/README.md"])).toEqual({ lint: false, build: false, e2e: true });
  });

  it("joue le build pour tout .ts hors tests/, que `next build` type-vérifie", () => {
    expect(classifyChangedFiles(["e2e/auth.spec.ts"])).toEqual(ALL);
    expect(classifyChangedFiles(["playwright.config.ts"])).toEqual(ALL);
    expect(classifyChangedFiles(["scripts/tool.ts"])).toEqual({ lint: true, build: true, e2e: true });
    expect(classifyChangedFiles(["middleware.ts"])).toEqual(ALL);
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
    ["scripts/ci-changed-jobs.cjs"],
    ["scripts/ci-deps-hash.cjs"],
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

  it("compte l'ancien chemin d'un fichier renommé", () => {
    // Le workflow passe `filename` et `previous_filename` : sortir un fichier
    // de `lib/` vers `docs/` doit encore jouer le build.
    expect(classifyChangedFiles(["docs/old.ts.md", "lib/old.ts"])).toEqual(ALL);
  });
});

describe("chemins encodés en JSON", () => {
  it("décode une ligne `@json` de jq", () => {
    expect(decodeLine('"lib/a b.ts"')).toBe("lib/a b.ts");
    expect(decodeLine('"e2e/Sc\\u00e9nario.md"')).toBe("e2e/Scénario.md");
    expect(decodeLine("  ")).toBe("");
  });

  it("fait tout jouer pour un nom à saut de ligne, qui coupé échapperait aux motifs", () => {
    expect(classifyChangedFiles(["docs/a.md", decodeLine(JSON.stringify("foo\ntests/x.ts"))])).toEqual(ALL);
    expect(classifyChangedFiles(["docs/a.md\u0007"])).toEqual(ALL);
  });

  it("voit un caractère de contrôle en tête ou en fin, que `trim()` effacerait", () => {
    expect(classifyChangedFiles(["\ttests/a.ts"])).toEqual(ALL);
    expect(classifyChangedFiles([decodeLine(JSON.stringify("\ntests/a.ts"))])).toEqual(ALL);
    expect(classifyChangedFiles(["tests/a.ts\u0000"])).toEqual(ALL);
  });

  it("fait tout jouer pour une ligne illisible ou qui n'est pas une chaîne", () => {
    for (const line of ['"foo', "docs/a.md", "42", "null", '["lib/a.ts"]']) {
      expect(classifyChangedFiles(["docs/x.md", decodeLine(line)])).toEqual(ALL);
    }
  });
});

describe("script en ligne de commande", () => {
  it("écrit les sorties au format de $GITHUB_OUTPUT", () => {
    expect(formatOutputs({ lint: true, build: false, e2e: true })).toBe("lint=true\nbuild=false\ne2e=true\n");
  });

  it("lit les chemins sur l'entrée standard", () => {
    const out = execFileSync(process.execPath, [SCRIPT], { input: '"tests/a.test.ts"\n"docs/b.md"\n', encoding: "utf8" });
    expect(out).toBe("lint=true\nbuild=false\ne2e=false\n");
  });

  it("joue tout pour une entrée qui n'est pas en JSON", () => {
    const out = execFileSync(process.execPath, [SCRIPT], { input: "docs/b.md\n", encoding: "utf8" });
    expect(out).toBe("lint=true\nbuild=true\ne2e=true\n");
  });
});

describe("workflow CI", () => {
  const ci = readSource(".github/workflows/ci.yml");
  const setup = readSource(".github/actions/setup/action.yml");

  it("annule l'exécution précédente d'une même PR, jamais une fusion sur main", () => {
    expect(ci).toMatch(/concurrency:\n\s+group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n\s+cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  });

  it("fait tout jouer quand la base de la PR n'a pas encore le script de tri", () => {
    expect(ci).toMatch(/if \[ -f scripts\/ci-changed-jobs\.cjs \]; then[\s\S]+?else[\s\S]+?printf 'lint=true\\nbuild=true\\ne2e=true\\n'/);
  });

  it("épingle chaque action tierce sur un SHA de commit", () => {
    for (const source of [ci, setup, readSource(".github/workflows/version-bump.yml")]) {
      for (const use of source.match(/uses: [^\s.]\S*/g) ?? []) {
        expect(use).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("branche chaque job conditionnel sur la sortie du tri, une sortie absente faisant jouer le job", () => {
    for (const job of ["lint", "build", "e2e"]) {
      expect(ci).toContain(`if: needs.changes.outputs.${job} != 'false'`);
    }
    expect(ci).not.toMatch(/needs\.changes\.outputs\.\w+ == 'true'/);
    expect(ci).toContain("node scripts/ci-changed-jobs.cjs");
  });

  it("fait échouer le tri si le script échoue, malgré `tee`", () => {
    expect(ci).toMatch(/id: filter\n\s+shell: bash/);
  });

  it("trie avec le script de la base de la PR, pas celui qu'elle apporte", () => {
    expect(ci).toContain("ref: ${{ github.event.pull_request.base.sha || github.sha }}");
  });

  it("lit les anciens chemins des renommages, 100 fichiers par page", () => {
    expect(ci).toContain("files?per_page=100");
    expect(ci).toContain(".filename, (.previous_filename // empty) | @json");
  });

  it("joue tout si la liste des fichiers est illisible", () => {
    expect(ci).toMatch(/elif ! files=\$\(gh api --paginate[\s\S]+?files='"\.github\/workflows\/ci\.yml"'/);
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

  it("indexe node_modules sur l'empreinte des dépendances et n'installe qu'en cas d'absence", () => {
    expect(setup).toContain("path: node_modules");
    expect(setup).toContain("node20-${{ steps.deps.outputs.hash }}");
    expect(setup).toMatch(/hash=\$\(node scripts\/ci-deps-hash\.cjs\)\n\s+echo "hash=\$hash"/);
    expect(setup).toContain("if: steps.node-modules.outputs.cache-hit != 'true'");
    expect(setup).toContain("run: npm ci --ignore-scripts");
  });

  it("reprend l'empreinte des dépendances dans toutes les clés, jamais le verrou brut", () => {
    expect(ci).not.toContain("hashFiles('package-lock.json'");
    expect(ci.match(/steps\.setup\.outputs\.deps-hash/g)).toHaveLength(6);
  });

  it("borne la durée de chaque job", () => {
    const jobs = ci.split("\njobs:\n")[1] ?? "";
    const declared = jobs.match(/^ {2}[a-z0-9-]+:$/gm) ?? [];
    const timeouts = jobs.match(/^ {4}timeout-minutes: \d+$/gm) ?? [];
    expect(declared.length).toBeGreaterThan(0);
    expect(timeouts).toHaveLength(declared.length);
  });
});

describe("depsHash", () => {
  const HASH_SCRIPT = join(__dirname, "..", "..", "scripts", "ci-deps-hash.cjs");
  const { depsHash } = require(HASH_SCRIPT) as { depsHash: (pkg: string, lock: string) => string };
  const pkg = (version: string, deps: Record<string, string> = { next: "^15" }) =>
    JSON.stringify({ name: "x", version, dependencies: deps });
  const lock = (version: string, next = "15.5.27") =>
    JSON.stringify({ name: "x", version, packages: { "": { version }, "node_modules/next": { version: next } } });

  it("ignore le numéro de version que réécrit le bump à la fusion", () => {
    expect(depsHash(pkg("1.0.0"), lock("1.0.0"))).toBe(depsHash(pkg("1.0.1"), lock("1.0.1")));
  });

  it("change quand une dépendance change dans package.json, même sans verrou à jour", () => {
    expect(depsHash(pkg("1.0.0"), lock("1.0.0"))).not.toBe(depsHash(pkg("1.0.0", { next: "^16" }), lock("1.0.0")));
  });

  it("change quand le verrou résout une autre version", () => {
    expect(depsHash(pkg("1.0.0"), lock("1.0.0"))).not.toBe(depsHash(pkg("1.0.0"), lock("1.0.0", "15.5.28")));
  });

  it("tolère un verrou sans racine", () => {
    expect(depsHash(pkg("1"), JSON.stringify({ version: "1" }))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuse un fichier illisible au lieu de rendre une empreinte", () => {
    expect(() => depsHash("{", lock("1"))).toThrow();
  });

  it("lit les fichiers du dépôt en ligne de commande", () => {
    const out = execFileSync(process.execPath, [HASH_SCRIPT], { cwd: join(__dirname, "..", ".."), encoding: "utf8" });
    expect(out).toMatch(/^[0-9a-f]{64}\n$/);
  });
});
