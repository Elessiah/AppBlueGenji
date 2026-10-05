import { globals, stripComments } from "./style-sweep";

/**
 * Lecture des jetons de `:root` (app/globals.css) pour les tests de contraste
 * des lots « site plus lumineux » (LANDING_ANIMATIONS.md) : valeur hexadécimale
 * d'un jeton, triplet d'un jeton `-rgb`, et mélange d'un voile teinté sur une
 * surface — le fond réel sous un texte teinté.
 */
const root = stripComments(globals).match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];

export const tokenHex = (name: string): string => root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1];

export const tokenTriplet = (name: string): number[] =>
  root
    .match(new RegExp(`${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+);`))!
    .slice(1, 4)
    .map(Number);

export function blend(baseHex: string, tint: number[], alpha: number): string {
  const base = [1, 3, 5].map((i) => Number.parseInt(baseHex.slice(i, i + 2), 16));
  const mixed = base.map((c, i) => Math.round(c * (1 - alpha) + tint[i] * alpha));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Teinte de texte (`--tone-ink`) et de fond (`--tone-rgb`) de chaque `data-tone` froid. */
export const COLD_TONE_TOKENS: Record<string, { ink: string; rgb: string }> = {
  blue: { ink: "--blue-300", rgb: "--blue-500-rgb" },
  violet: { ink: "--violet-300", rgb: "--violet-400-rgb" },
  cyan: { ink: "--cyan-400", rgb: "--cyan-400-rgb" },
  teal: { ink: "--teal-400", rgb: "--teal-400-rgb" },
  pink: { ink: "--pink-400", rgb: "--pink-400-rgb" },
};
