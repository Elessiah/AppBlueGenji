import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "../helpers/read-source";

/**
 * Les polices du site sont **dans le dépôt**, jamais chez Google.
 *
 * `next/font/google` va chercher les fichiers sur `fonts.gstatic.com` au
 * démarrage de `next dev` et à la compilation. Le job E2E du CI dépendait donc
 * d'un appel sortant qu'aucun cache ne couvrait, et échouait par intermittence
 * avant d'avoir joué un seul test (« next/font/google queries have exactly one
 * entry », puis l'attente du serveur de Playwright dépassée). La panne ne se
 * voit pas en local, où le réseau répond : seul un balayage peut la tenir.
 */

const ROOT = join(__dirname, "..", "..");
const FONTS_DIR = join(ROOT, "app", "fonts");
const LAYOUT = readSource("app/layout.tsx");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = ["app", "components", "lib"]
  .flatMap((dir) => walk(join(ROOT, dir)))
  .filter((path) => /\.(ts|tsx)$/.test(path));

/** Chemins de fichiers de police cités par la mise en page racine. */
const referencedFonts = [...LAYOUT.matchAll(/["'](\.\/fonts\/[^"']+\.woff2)["']/g)].map((m) => m[1]);

describe("polices hébergées dans le dépôt", () => {
  it("trouve bien des sources à balayer", () => {
    // Sans ce garde, un chemin déplacé rendrait le balayage vide — donc vert.
    expect(sources.length).toBeGreaterThan(50);
  });

  it("n'importe jamais `next/font/google`", () => {
    const offenders = sources
      .filter((path) => /from\s+["']next\/font\/google["']/.test(readSource(path)))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("déclare les cinq familles par `next/font/local`", () => {
    expect(LAYOUT).toMatch(/import localFont from "next\/font\/local";/);
    for (const variable of ["--font-title", "--font-body", "--font-sans", "--font-mono", "--font-display"]) {
      expect(LAYOUT).toContain(`variable: "${variable}"`);
    }
  });

  it("ne cite que des fichiers présents", () => {
    // `next/font/local` échoue à la compilation sur un fichier absent, mais
    // seulement là : le test le dit sans attendre un `next build`.
    expect(referencedFonts.length).toBeGreaterThanOrEqual(5);
    for (const path of referencedFonts) {
      expect(existsSync(join(ROOT, "app", path))).toBe(true);
    }
  });

  it("n'embarque aucun fichier de police que rien ne cite", () => {
    const shipped = readdirSync(FONTS_DIR).filter((name) => name.endsWith(".woff2"));
    const cited = new Set(referencedFonts.map((path) => path.replace("./fonts/", "")));
    expect(shipped.filter((name) => !cited.has(name))).toEqual([]);
  });

  it("garde la licence de chaque famille à côté de ses fichiers", () => {
    // Les cinq familles sont sous licence SIL OFL, qui exige que la licence
    // accompagne les fichiers redistribués.
    const families = new Set(
      readdirSync(FONTS_DIR)
        .filter((name) => name.endsWith(".woff2"))
        .map((name) => name.replace(/-latin-.*$/, "")),
    );
    expect(families.size).toBe(5);
    for (const family of families) {
      const license = join(FONTS_DIR, `${family}-OFL.txt`);
      expect(existsSync(license)).toBe(true);
      expect(readSource(license)).toContain("SIL Open Font License");
    }
  });
});
