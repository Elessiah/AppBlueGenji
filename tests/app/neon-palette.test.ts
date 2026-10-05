import { describe, expect, it } from "@jest/globals";
import { contrastRatio, relativeLuminance } from "@/lib/shared/color-contrast";
import { globals, stripComments } from "./_lib/style-sweep";

/**
 * Palette « néon froid » (docs/features/DESIGN_SYSTEM.md) : chaque jeton de
 * texte coloré tient 4,5:1 sur le fond le plus clair du site, aucun texte
 * secondaire n'est un gris neutre, aucune teinte chaude n'entre dans la palette.
 */

const sheet = stripComments(globals);
const root = sheet.match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const token = (name: string) => root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))?.[1];
const SURFACE = "#161a22"; // --cyber-bg-3, le fond le plus clair

const TEXT_TOKENS = [
  "--ink",
  "--ink-mute",
  "--ink-dim",
  "--text-0",
  "--text-1",
  "--text-2",
  "--blue-300",
  "--blue-500",
  "--cyan-400",
  "--violet-300",
  "--violet-400",
  "--pink-400",
  "--teal-400",
];

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

describe("contrastRatio", () => {
  it("donne 21:1 entre noir et blanc, 1:1 entre deux couleurs égales, quel que soit l'ordre", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#5ac8ff", "#5ac8ff")).toBe(1);
    expect(contrastRatio("#05060a", "#a3bcd8")).toBeCloseTo(contrastRatio("#a3bcd8", "#05060a"), 10);
  });

  it("refuse un format autre que #rrggbb", () => {
    expect(() => relativeLuminance("#fff")).toThrow();
    expect(() => relativeLuminance("rgb(0,0,0)")).toThrow();
  });
});

describe("palette néon froid", () => {
  it.each(TEXT_TOKENS)("%s tient 4,5:1 sur le fond le plus clair", (name) => {
    const value = token(name);
    expect(value).toBeDefined();
    expect(contrastRatio(value!, SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it("les textes secondaires sont teintés de bleu, jamais d'un gris neutre", () => {
    for (const name of ["--ink", "--ink-mute", "--ink-dim", "--ink-faint", "--text-1", "--text-2"]) {
      const [r, g, b] = rgb(token(name)!);
      expect(b).toBeGreaterThan(r);
      expect(b - r).toBeGreaterThanOrEqual(16);
      expect(b).toBeGreaterThanOrEqual(g);
    }
  });

  it("aucune teinte chaude parmi les néons (rouge > bleu interdit, hors rose de rehaut)", () => {
    for (const name of ["--cyan-400", "--violet-300", "--violet-400", "--teal-400"]) {
      const [r, , b] = rgb(token(name)!);
      expect(b).toBeGreaterThan(r);
    }
    // Le rose reste froid : sa composante bleue domine le vert.
    const [, g, b] = rgb(token("--pink-400")!);
    expect(b).toBeGreaterThan(g);
  });

  it("déclare un dégradé de marque bleu → violet", () => {
    expect(root).toMatch(/--grad-brand:\s*linear-gradient\([^;]*--blue-500[^;]*--violet-400/);
  });

  it("chaque variante de pastille a sa couleur, et le rouge reste à .pill-live", () => {
    for (const variant of ["info", "accent", "success", "highlight", "neutral", "waiting"]) {
      expect(sheet).toMatch(new RegExp(`\\.pill-${variant}\\b[^{]*\\{[^}]*color:`));
    }
    const nonLive = [...sheet.matchAll(/\.(?:pill|tag)-(?!live)[a-z]+[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
    expect(nonLive).not.toMatch(/--red-live/);
  });

  it("la pastille d'attente respire, figée par le régime de charge", () => {
    const waiting = sheet.match(/\.pill-waiting\s*\{([^}]*)\}/)![1];
    expect(waiting).toMatch(/animation:[^;]*infinite/);
    expect(waiting).toMatch(/animation-play-state:\s*var\(--deco-anim-state\)/);
  });

  it("l'apparition au défilement n'est qu'un état posé par JavaScript, en transform/opacité", () => {
    const pending = sheet.match(/\.reveal-pending\s*\{([^}]*)\}/)![1];
    const props = [...pending.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).sort();
    expect(props).toEqual(["opacity", "transform"]);
  });
});
