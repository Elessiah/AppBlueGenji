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

/**
 * Le chrome de la carte « option » (`.checkbox-card`), écrit **une fois**.
 *
 * Deux écrans posent cette carte pour le même réglage — le formulaire de
 * tournoi et la carte de phase —, et son cadre dit **trois** choses : coché ou
 * non, et cliquable ou non. Verrouillée, elle gardait le chrome d'une carte qui
 * répond au clic (bleu plein si cochée, cadre ordinaire sinon), seul le texte
 * changeant ; elle passe donc en sourdine dans les deux cas, comme la case
 * désactivée qu'elle contient.
 *
 * Le verrou ne se dit **jamais** par une `opacity` : elle se multiplierait avec
 * la bordure de la case, seule à dessiner un contrôle décoché (`globals.css`),
 * et l'effacerait. Une couleur, elle, ne se compose pas.
 *
 * Les quatre bleus descendent tous du **même** token : `var(--blue-500)` pour
 * l'opaque, `rgba(var(--blue-500-rgb), …)` pour les voiles — un style en ligne
 * résout les propriétés personnalisées comme une feuille. Écrits en dur à côté
 * d'un `var()`, ils auraient posé sur une même carte une bordure d'une teinte
 * et un fond d'une autre au premier réglage du bleu du site : c'est la raison
 * pour laquelle `--blue-500-rgb` existe (`globals.css`), elle vaut ici aussi.
 */
export function checkboxCardChrome(
  checked: boolean,
  locked: boolean,
): { border: string; backgroundColor: string } {
  if (locked) {
    return checked
      ? {
          border: "1.5px solid rgba(var(--blue-500-rgb), 0.25)",
          backgroundColor: "rgba(var(--blue-500-rgb), 0.03)",
        }
      : { border: "1.5px solid var(--line-soft)", backgroundColor: "transparent" };
  }
  return checked
    ? {
        border: "1.5px solid var(--blue-500)",
        backgroundColor: "rgba(var(--blue-500-rgb), 0.07)",
      }
    : { border: "1.5px solid var(--line-strong-cy)", backgroundColor: "transparent" };
}
