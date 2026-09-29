/**
 * Plancher de taille de texte : 11 px.
 *
 * Un audit mobile relevait des textes à 9 px (compte à rebours et mois du
 * calendrier de l'accueil, libellés d'en-tête de tournoi, KPI de `/bot`,
 * « PTS / Forme » de l'annuaire), à 8-8,96 px (initiales des emblèmes, « ▶ »
 * des cartes) et des surtitres mono à 10 px. Ils sont tous montés à 11 px ; ce
 * balayage refuse qu'une feuille ou un style en ligne redescende en dessous.
 *
 * `font-size: 0` reste permis : c'est une technique de masquage du texte, pas
 * une taille de lecture. Les cartes d'aperçu (`components/og`) sont des images
 * rendues à 1200 px, hors du champ.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const FLOOR_PX = 11;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "og") continue;
      walk(path, out);
    } else if (/\.(css|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const FILES = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];

/** Tailles littérales en px (CSS) ou nombres nus (style en ligne React). */
const PATTERNS = [
  /font-size:\s*(\d+(?:\.\d+)?)px/g,
  /fontSize:\s*"(\d+(?:\.\d+)?)px"/g,
  /fontSize:\s*(\d+(?:\.\d+)?)\s*[,}\n]/g,
];

describe("plancher de taille de texte", () => {
  it("balaie bien des feuilles et des composants", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it(`n'écrit aucune taille de police sous ${FLOOR_PX} px`, () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const pattern of PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          const size = Number(match[1]);
          if (size > 0 && size < FLOOR_PX) {
            const line = source.slice(0, match.index).split("\n").length;
            offenders.push(`${relative(ROOT, file)}:${line} → ${match[0].trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("borne aussi l'initiale calculée des emblèmes d'engagés", () => {
    const css = readFileSync(
      join(ROOT, "app", "(secured)", "tournois", "[id]", "_components", "EntrantName.module.css"),
      "utf8",
    );
    expect(css).toContain(`font-size: max(${FLOOR_PX}px, calc(var(--size) * 0.56));`);
  });
});
