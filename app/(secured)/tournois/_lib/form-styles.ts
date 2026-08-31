/**
 * Rythme vertical du formulaire de tournoi.
 *
 * Sections séparées par un filet, même gouttière de grille partout, textes
 * d'aide sur les tokens « cyber ».
 *
 * Extraits du composant pour être partagés avec les blocs de réglages propres à
 * chaque format (`_components/FormatSettings`), qui doivent s'aligner sur la
 * même grille et les mêmes textes d'aide que le reste du formulaire.
 */
import type { CSSProperties } from "react";

export const SECTION_STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 28 };
export const SECTION_SEPARATOR: CSSProperties = {
  paddingTop: 28,
  borderTop: "1px solid var(--line-soft)",
};
export const EYEBROW: CSSProperties = { margin: "0 0 16px" };
export const GRID: CSSProperties = { gap: 16 };
export const FULL_WIDTH: CSSProperties = { gridColumn: "1 / -1" };
export const HINT: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12.5,
  color: "var(--ink-mute)",
  lineHeight: 1.5,
};
