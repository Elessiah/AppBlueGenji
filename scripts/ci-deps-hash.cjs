/**
 * Empreinte des dépendances pour les clés de cache du CI — docs/features/CI.md.
 *
 * `package.json` **et** `package-lock.json`, numéro de version du paquet
 * retiré : le bump de version à la fusion (`version-bump.yml`) réécrit ce
 * numéro dans les deux fichiers, et une clé qui le lisait repartait à froid à
 * chaque PR. `package.json` compte, lui : une dépendance ajoutée sans verrou à
 * jour change la clé, `npm ci` tourne et refuse le désaccord — sans quoi le
 * `node_modules` du cache aurait passé au vert une PR que la production ne sait
 * pas installer.
 */
"use strict";

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * @param {string} packageJson contenu de `package.json`
 * @param {string} packageLock contenu de `package-lock.json`
 * @returns {string} empreinte SHA-256 en hexadécimal
 */
function depsHash(packageJson, packageLock) {
  const pkg = JSON.parse(packageJson);
  const lock = JSON.parse(packageLock);
  delete pkg.version;
  delete lock.version;
  if (lock.packages && lock.packages[""]) delete lock.packages[""].version;
  return createHash("sha256").update(JSON.stringify([pkg, lock])).digest("hex");
}

module.exports = { depsHash };

if (require.main === module) {
  const root = process.argv[2] ?? process.cwd();
  const read = (file) => readFileSync(join(root, file), "utf8");
  process.stdout.write(`${depsHash(read("package.json"), read("package-lock.json"))}\n`);
}
