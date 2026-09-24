import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, stripComments, walk } from "./_lib/style-sweep";

/**
 * Le réglage « Contraste renforcé » ne tient que par les **jetons**.
 *
 * Il redéfinit `--ink-dim`, `--ink-mute`, `--text-*`… sous
 * `:root[data-a11y~="contrast"]` : tout texte qui lit un jeton est rattrapé, un
 * écran ajouté demain compris. Un texte qui écrit sa couleur **en dur** lui
 * échappe — le lecteur coche la case, et ce texte-là reste pâle. L'audit fait à
 * l'ouverture de ce contrôle (toutes les pages, rendu réel, réglage coché) n'a
 * trouvé aucun texte sous 4,5:1 : ce balayage garde cet état.
 *
 * Il refuse donc toute couleur de texte littérale qui, posée sur
 * `--cyber-bg-3` (le fond le plus clair du site), resterait **sous** 4,5:1 sans
 * être un texte foncé. Un texte foncé (rapport sous 1,5) est un texte posé sur
 * un aplat clair — bouton plein, pastille —, dont le fond n'est pas celui-là :
 * le balayage ne sait pas le juger, et ce ne sont pas ces textes que le réglage
 * a vocation à éclaircir. Entre les deux, c'est un gris ou une transparence
 * sur fond sombre : qu'il passe par un jeton, et le réglage l'atteindra.
 */

const SURFACE: [number, number, number] = [0x16, 0x1a, 0x22]; // --cyber-bg-3

function parseColor(raw: string): [number, number, number, number] | null {
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  return null;
}

function ratioOnSurface([r, g, b, a]: [number, number, number, number]): number {
  const mixed = [r, g, b].map((channel, i) => channel * a + SURFACE[i] * (1 - a));
  const luminance = (rgb: number[]) => {
    const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [luminance(mixed), luminance(SURFACE)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Déclarations `color:` littérales (ni `background-color`, ni `var(…)`), en CSS comme en style en ligne. */
const COLOR_DECLARATION = /(?<![\w-])color\s*:\s*["']?(#[0-9a-f]{3,6}\b|rgba?\([^)]*\))/gi;

function lowContrastLiterals(): string[] {
  const files = [
    ...walk(join(ROOT, "app"), ".css"),
    ...walk(join(ROOT, "components"), ".css"),
    ...walk(join(ROOT, "app"), ".tsx"),
    ...walk(join(ROOT, "components"), ".tsx"),
  ];
  const found: string[] = [];
  for (const file of files) {
    const source = file.endsWith(".css") ? stripComments(readFileSync(file, "utf8")) : readFileSync(file, "utf8");
    for (const match of source.matchAll(COLOR_DECLARATION)) {
      const color = parseColor(match[1]);
      if (!color) continue;
      const ratio = ratioOnSurface(color);
      if (ratio >= 1.5 && ratio < 4.5) {
        found.push(`${relative(ROOT, file)} — ${match[1]} (${ratio.toFixed(2)}:1)`);
      }
    }
  }
  return found;
}

describe("contraste renforcé — aucun texte pâle hors des jetons", () => {
  it("détecte bien un gris en dur (témoin du balayage)", () => {
    expect(ratioOnSurface(parseColor("#55636f")!)).toBeLessThan(4.5);
    expect(ratioOnSurface(parseColor("rgba(255, 255, 255, 0.3)")!)).toBeLessThan(4.5);
    expect(ratioOnSurface(parseColor("#001520")!)).toBeLessThan(1.5);
    expect("color: #55636f".match(COLOR_DECLARATION)).not.toBeNull();
    expect('style={{ color: "rgba(255,255,255,0.3)" }}'.match(COLOR_DECLARATION)).not.toBeNull();
    expect("background-color: #55636f".match(COLOR_DECLARATION)).toBeNull();
    expect("border-color: #55636f".match(COLOR_DECLARATION)).toBeNull();
    expect("color: var(--ink-dim, #55636f)".match(COLOR_DECLARATION)).toBeNull();
  });

  it("aucune couleur de texte littérale ne reste sous 4,5:1 sur fond sombre", () => {
    expect(lowContrastLiterals()).toEqual([]);
  });
});
