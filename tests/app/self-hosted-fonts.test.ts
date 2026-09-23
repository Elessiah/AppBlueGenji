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
const SITE_FONTS = readSource("app/site-fonts.ts");

/** Les sous-ensembles que servait `next/font/google`, dans l'ordre de la pile. */
const SUBSETS = "latin|latin-ext|cyrillic|cyrillic-ext|greek|greek-ext|vietnamese|devanagari";
const FILE_NAME = new RegExp(`^(.+?)-(${SUBSETS})-(wght|\\d{3})-normal\\.woff2$`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = ["app", "components", "lib"]
  .flatMap((dir) => walk(join(ROOT, dir)))
  .filter((path) => /\.(ts|tsx)$/.test(path));

/** Chaque appel `localFont({ … })` du module, avec son nom de constante. */
const faces = [...SITE_FONTS.matchAll(/const (\w+) = localFont\(\{([\s\S]*?)\n\}\);/g)].map((m) => ({
  name: m[1],
  body: m[2],
}));

/** Chemins de fichiers de police cités par le module. */
const referencedFonts = [...SITE_FONTS.matchAll(/["'](\.\/fonts\/[^"']+\.woff2)["']/g)].map((m) => m[1]);

describe("polices hébergées dans le dépôt", () => {
  it("trouve bien des sources et des polices à balayer", () => {
    // Sans ce garde, un chemin déplacé rendrait le balayage vide — donc vert.
    expect(sources.length).toBeGreaterThan(50);
    expect(faces.length).toBeGreaterThanOrEqual(5);
  });

  it("n'importe jamais `next/font/google`", () => {
    const offenders = sources
      .filter((path) => /from\s+["']next\/font\/google["']/.test(readSource(path)))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it("pose les cinq variables sur `<body>`, sous leurs noms d'origine", () => {
    for (const variable of ["--font-title", "--font-body", "--font-sans", "--font-mono", "--font-display"]) {
      expect(SITE_FONTS).toContain(`"${variable}": fontStack([`);
    }
    expect(readSource("app/layout.tsx")).toContain("<body style={FONT_VARIABLES}>");
  });

  it("ne cite que des fichiers présents", () => {
    // `next/font/local` échoue à la compilation sur un fichier absent, mais
    // seulement là : le test le dit sans attendre un `next build`.
    expect(referencedFonts.length).toBeGreaterThanOrEqual(faces.length);
    for (const path of referencedFonts) {
      expect(existsSync(join(ROOT, "app", path))).toBe(true);
    }
  });

  it("n'embarque aucun fichier de police que rien ne cite", () => {
    const shipped = readdirSync(FONTS_DIR).filter((name) => name.endsWith(".woff2"));
    const cited = new Set(referencedFonts.map((path) => path.replace("./fonts/", "")));
    expect(shipped.filter((name) => !cited.has(name))).toEqual([]);
  });

  it("garde tous les sous-ensembles, pas seulement le latin", () => {
    // `next/font/google` téléchargeait **tous** les sous-ensembles et ne
    // préchargeait que ceux de `subsets` : ne livrer que le latin ferait rendre
    // en Arial, lettre par lettre, le `Ł` d'un pseudo ou un nom cyrillique.
    const shipped = readdirSync(FONTS_DIR).filter((name) => name.endsWith(".woff2"));
    const subsetsOf = (family: string) =>
      new Set(shipped.map((name) => FILE_NAME.exec(name)).filter((m) => m?.[1] === family).map((m) => m![2]));
    for (const family of ["inter", "exo-2", "jetbrains-mono", "rajdhani"]) {
      expect(subsetsOf(family)).toContain("latin-ext");
    }
    expect(subsetsOf("inter")).toContain("cyrillic");
    expect(subsetsOf("inter")).toContain("greek");
  });

  it("borne chaque sous-ensemble par son `unicode-range`, et ne précharge que le latin", () => {
    for (const face of faces) {
      expect(face.body).toMatch(/prop: "unicode-range", value: "U\+[0-9A-F]/);
      const isLatin = /Latin$/.test(face.name);
      // Précharger un sous-ensemble ferait télécharger ses glyphes à chaque
      // page, même quand aucun n'y figure.
      expect(face.body.includes("preload: false")).toBe(!isLatin);
      // Un seul repli ajusté par famille : celui du latin, placé en fin de pile.
      expect(face.body.includes("adjustFontFallback: false")).toBe(!isLatin);
    }
  });

  it("garde la licence de chaque famille à côté de ses fichiers", () => {
    // Les cinq familles sont sous licence SIL OFL, qui exige que la licence
    // accompagne les fichiers redistribués.
    const families = new Set(
      readdirSync(FONTS_DIR)
        .filter((name) => name.endsWith(".woff2"))
        .map((name) => FILE_NAME.exec(name)?.[1] ?? name),
    );
    expect(families.size).toBe(5);
    for (const family of families) {
      const license = join(FONTS_DIR, `${family}-OFL.txt`);
      expect(existsSync(license)).toBe(true);
      expect(readSource(license)).toContain("SIL Open Font License");
    }
  });
});
