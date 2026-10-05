import { describe, expect, it } from "@jest/globals";
import { join, relative } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { globals, innermostBlocks, ROOT, stripComments, walk } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Défaite — teinte réservée (DESIGN_SYSTEM.md § Défaite) : un cramoisi qui ne
 * sert à rien d'autre, lisible (AA) partout où il est un texte, et distinct
 * du rouge du direct, du saumon des erreurs et du rose de rehaut.
 */

const sheet = stripComments(globals);
const root = sheet.match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const contrastBlock = sheet.match(/:root\[data-a11y~="contrast"\],\s*\.a11y-always-contrast\s*\{([^}]*)\}/)![1];
const hex = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))?.[1];
const SURFACE = hex(root, "--cyber-bg-3")!;

function rgb(value: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
}

function blend(base: string, tint: number[], alpha: number): string {
  const mixed = rgb(base).map((c, i) => Math.round(c * (1 - alpha) + tint[i] * alpha));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Écart de teinte (degrés) entre deux couleurs. */
function hue(value: string): number {
  const [r, g, b] = rgb(value).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

const LOSS = hex(root, "--result-loss")!;
const LOSS_INK = hex(root, "--result-loss-ink")!;
const LOSS_RGB = root.match(/--result-loss-rgb:\s*(\d+),\s*(\d+),\s*(\d+);/)!.slice(1, 4).map(Number);

/** Un sélecteur, ou un voisinage de code, qui parle d'une défaite. */
const LOSS_CONTEXT = /loss|lose|lost|défaite|\.l\b|\.decided\b/i;

const CSS_FILES = [...walk(join(ROOT, "app"), ".css"), ...walk(join(ROOT, "components"), ".css")];
const TSX_FILES = [...walk(join(ROOT, "app"), ".tsx"), ...walk(join(ROOT, "components"), ".tsx")];

describe("jetons de la défaite", () => {
  it("déclare la teinte, son triplet, son encre et ses variantes en fin de :root", () => {
    expect(LOSS).toBe("#ff1f5a");
    expect(LOSS_RGB).toEqual(rgb(LOSS));
    for (const name of ["--result-loss-soft", "--result-loss-glow", "--result-loss-hatch"]) {
      expect(root).toMatch(new RegExp(`${name}:[^;]*--result-loss`));
    }
  });

  it("garde l'encre lisible (AA) sur le fond le plus clair et sur un fond teinté de défaite", () => {
    expect(contrastRatio(LOSS_INK, SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LOSS_INK, blend(SURFACE, LOSS_RGB, 0.12))).toBeGreaterThanOrEqual(4.5);
    // La teinte pleine, elle, n'est qu'un remplissage : 3:1 pour un élément graphique.
    expect(contrastRatio(LOSS, SURFACE)).toBeGreaterThanOrEqual(3);
  });

  it("éclaircit l'encre en contraste renforcé", () => {
    const strong = hex(contrastBlock, "--result-loss-ink")!;
    expect(contrastRatio(strong, SURFACE)).toBeGreaterThan(contrastRatio(LOSS_INK, SURFACE));
  });

  it("ne se confond ni avec le direct, ni avec les erreurs, ni avec le rose de rehaut", () => {
    for (const name of ["--red-live", "--danger", "--pink-400", "--violet-400", "--amber"]) {
      const other = hex(root, name)!;
      expect(other).not.toBe(LOSS);
      const gap = Math.abs(hue(other) - hue(LOSS));
      // Le rouge du direct est voisin : la saturation et la forme (hachures) font l'écart.
      if (name !== "--red-live" && name !== "--danger") expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(20);
    }
    // Plus froide (tirée vers le magenta) et plus saturée que le direct et les erreurs.
    for (const name of ["--red-live", "--danger"]) {
      const other = hex(root, name)!;
      expect(hue(other) - hue(LOSS)).toBeGreaterThanOrEqual(7);
      expect(rgb(LOSS)[1]).toBeLessThan(rgb(other)[1] - 40);
    }
  });
});

describe("la défaite ne sert qu'à la défaite", () => {
  it("toute règle CSS qui lit la teinte vise une défaite", () => {
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      for (const [selector, body] of innermostBlocks(stripComments(readSource(file)))) {
        const uses = body.replace(/--result-loss[\w-]*\s*:[^;]*;/g, "");
        if (!/--result-loss/.test(uses)) continue;
        if (!LOSS_CONTEXT.test(selector)) offenders.push(`${relative(ROOT, file)} → ${selector.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("la classe .result-loss ne pare qu'un chiffre de défaite", () => {
    const offenders: string[] = [];
    for (const file of TSX_FILES) {
      const lines = readSource(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.includes("result-loss") && !line.includes('data-tone="loss"')) return;
        const around = lines.slice(Math.max(0, index - 2), index + 3).join("\n");
        if (!/loss|lost|défaite/i.test(around.replace(/result-loss/g, ""))) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("aucune barre de défaite ne reprend le rose", () => {
    for (const file of CSS_FILES) {
      for (const [selector, body] of innermostBlocks(stripComments(readSource(file)))) {
        if (/\.(?:formCell|tmFormCell)\.l\b/.test(selector)) {
          expect(body).not.toMatch(/--pink-400/);
          expect(body).toMatch(/var\(--result-loss-hatch\)/);
        }
      }
    }
  });

  it("habille chaque chiffre « Défaites » de la teinte", () => {
    expect(readSource(join(ROOT, "components", "stats", "StatsPanel.tsx"))).toMatch(
      /<Tile label="Défaites" value=\{stats\.matchesLost\} loss \/>/,
    );
    expect(readSource(join(ROOT, "app", "(secured)", "profil", "page.tsx"))).toMatch(
      /label: "Défaites", value: data\.stats\.matchesLost, tone: "loss"/,
    );
    expect(
      readSource(join(ROOT, "app", "(secured)", "equipes", "[id]", "_components", "TeamHeader.tsx")),
    ).toMatch(/label: "Défaites", value: team\.stats\.matchesLost, loss: true/);
    const profile = stripComments(readSource(join(ROOT, "app", "(secured)", "profil", "profil.module.css")));
    expect(profile).toMatch(/\[data-tone="loss"\]\s*\{[^}]*var\(--result-loss-ink\)[^}]*\}/);
  });

  it("garde l'ambre au forfait du perdant", () => {
    const css = stripComments(
      readSource(join(ROOT, "app", "(secured)", "tournois", "[id]", "_components", "MatchRow.module.css")),
    );
    expect(css).toMatch(/\.decided \.score:not\(\.forfeitScore\)\s*\{[^}]*--result-loss-ink/);
  });
});
