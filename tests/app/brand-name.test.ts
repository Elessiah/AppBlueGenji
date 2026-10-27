import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * La marque est « BlueGenji », jamais « BlueGenji Arena » : le mot « Arena »
 * ne reparaît ni dans un texte affiché, ni dans un identifiant du site.
 */

const ROOT = join(__dirname, "..", "..");
const DIRS = ["messages", "app", "components", "lib"];
const SOURCE = /\.(tsx?|jsx?|json|css|mjs)$/;

function collect(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, found);
    else if (SOURCE.test(entry.name)) found.push(path);
  }
  return found;
}

describe("marque — « Arena » retiré", () => {
  it("n'apparaît dans aucun fichier de messages/, app/, components/ ni lib/", () => {
    const offenders = DIRS.flatMap((dir) => collect(join(ROOT, dir)))
      .filter((file) => /arena/i.test(readFileSync(file, "utf8")) || /arena/i.test(relative(ROOT, file)))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
