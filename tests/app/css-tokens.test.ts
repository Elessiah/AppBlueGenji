import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(__dirname, "..", "..");

/** Tous les `.css` versionnés, feuilles globales et modules confondus. */
function cssFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.css"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/**
 * Aucune feuille de style ne commence par un BOM UTF-8.
 *
 * Ce n'est pas une préférence d'encodage : un BOM en tête d'un `.css` fait
 * partie du **premier sélecteur** pour le parseur, qui jette la règle entière
 * sans rien signaler. `app/globals.css` ouvrant sur `:root { … }`, c'est tout le
 * jeu de tokens hérités qui disparaissait — `--text-0/1/2`, `--bg-*`,
 * `--accent-*`, `--line`, `--radius`, `--danger`. Conséquence visible :
 * `body { color: var(--text-0) }` retombait sur du noir, et les ~90 endroits qui
 * écrivent `color: var(--text-2)` sans valeur de repli rendaient du noir sur
 * fond noir. Le second bloc `:root` (tokens cyber `--ink`, `--blue-*`) restait
 * intact, ce qui masquait la panne sur la plupart des écrans.
 *
 * Le piège se remet tout seul : un éditeur Windows qui réenregistre en
 * « UTF-8 avec BOM » suffit, et rien n'échoue — ni le build, ni le lint.
 */
describe("Feuilles de style — encodage", () => {
  const files = cssFiles();

  it("trouve bien les feuilles à contrôler", () => {
    // Un `git ls-files` qui ne rend rien ferait passer les cas suivants à vide.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("app/globals.css");
  });

  it.each(files)("%s ne commence pas par un BOM UTF-8", (file) => {
    const head = readFileSync(join(ROOT, file)).subarray(0, 3);
    expect([...head]).not.toEqual([0xef, 0xbb, 0xbf]);
  });
});

/**
 * Les tokens hérités existent — c'est ce que le BOM faisait disparaître.
 *
 * On lit la source plutôt que le rendu : Jest tourne sans navigateur, aucun
 * moteur CSS n'est là pour résoudre les `var()`. Ce qui est gardé, c'est que la
 * déclaration soit atteignable, c'est-à-dire dans un bloc que le parseur ne
 * jettera pas.
 */
describe("Tokens hérités de `app/globals.css`", () => {
  const source = readFileSync(join(ROOT, "app/globals.css"), "utf8");

  it("ouvre sur `:root`, sans rien devant", () => {
    expect(source.startsWith(":root {")).toBe(true);
  });

  it.each([
    "--text-0",
    "--text-1",
    "--text-2",
    "--bg-0",
    "--line",
    "--accent-blue",
    "--radius",
  ])("déclare %s dans le premier bloc `:root`", (token) => {
    const firstBlock = source.slice(0, source.indexOf("}"));
    expect(firstBlock).toContain(`${token}:`);
  });

  it("garde la couleur du corps de page adossée à un token déclaré", () => {
    // `body { color: var(--text-0) }` sans `--text-0` ne dégrade pas vers une
    // valeur claire : la déclaration devient invalide et le texte tombe en noir.
    expect(source).toMatch(/body \{\r?\n {2}color: var\(--text-0\);/);
  });
});
