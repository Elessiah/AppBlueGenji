/**
 * Jobs du CI à jouer selon les fichiers modifiés d'une PR — docs/features/CI.md.
 *
 * Lu par le job `changes` de `.github/workflows/ci.yml` : la liste des fichiers
 * arrive sur l'entrée standard (un chemin par ligne), les sorties partent au
 * format `clé=valeur` de `$GITHUB_OUTPUT`. Les tests Jest tournent toujours
 * (ils lisent aussi la documentation) ; seuls lint, build et E2E se décident ici.
 *
 * Toute incertitude joue tout : un workflow, une action ou les dépendances
 * modifiés, ou une liste vide ou tronquée (l'API plafonne à 3 000 fichiers).
 */
"use strict";

/** Plafond de l'API `pulls/{n}/files` : au-delà, la liste est tronquée. */
const API_FILE_LIMIT = 3000;

/** Le CI lui-même (workflows, action commune, scripts du CI) et les dépendances. */
const RUN_ALL = /^(\.github\/|scripts\/ci-|package\.json$|package-lock\.json$)/;
const LINTED = /\.(ts|tsx|js|jsx|mjs|cjs|json)$|^eslint-rules\//;
/**
 * Ce que `next build` compile ou type-vérifie (TypeScript 5) : `tsconfig.json`
 * inclut **tout** `.ts`/`.tsx` hors `tests/` — `e2e/`, `scripts/` compris.
 */
const BUILT =
  /^(app|components|lib|messages|public)\/|^(?!tests\/).*\.tsx?$|^(tsconfig\.json)$|^postcss\.config\.|\.css$/;
const E2E_ONLY = /^e2e\//;

/**
 * @param {readonly string[]} files chemins relatifs à la racine du dépôt
 * @returns {{ lint: boolean, build: boolean, e2e: boolean }}
 */
function classifyChangedFiles(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (paths.length === 0 || paths.length >= API_FILE_LIMIT || paths.some((f) => RUN_ALL.test(f))) {
    return { lint: true, build: true, e2e: true };
  }
  const build = paths.some((f) => BUILT.test(f));
  return {
    lint: paths.some((f) => LINTED.test(f)),
    build,
    e2e: build || paths.some((f) => E2E_ONLY.test(f)),
  };
}

/** @param {{ lint: boolean, build: boolean, e2e: boolean }} jobs */
function formatOutputs(jobs) {
  return `lint=${jobs.lint}\nbuild=${jobs.build}\ne2e=${jobs.e2e}\n`;
}

module.exports = { classifyChangedFiles, formatOutputs, API_FILE_LIMIT };

if (require.main === module) {
  const input = require("node:fs").readFileSync(0, "utf8");
  process.stdout.write(formatOutputs(classifyChangedFiles(input.split("\n"))));
}
