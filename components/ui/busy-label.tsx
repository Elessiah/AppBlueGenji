import type { ReactNode } from "react";

/**
 * Libellé d'un bouton d'envoi qui change pendant la requête (« Enregistrer » →
 * « Enregistrement… »). Les deux textes occupent la **même case** (grille) : le
 * bouton prend la largeur du plus long, il ne bouge pas quand l'envoi part et
 * ne pousse pas ses voisins (375 px, lignes qui passent à la ligne).
 * `visibility: hidden` retire le texte inactif de l'arbre d'accessibilité : le
 * nom du bouton reste le seul libellé visible → `docs/features/BUSY_BUTTONS.md`.
 */
export function BusyLabel({ busy, idle, pending }: Readonly<{ busy: boolean; idle: ReactNode; pending: ReactNode }>) {
  return (
    <span style={{ display: "inline-grid" }}>
      <span style={{ gridArea: "1 / 1", visibility: busy ? "hidden" : "visible" }}>{idle}</span>
      <span style={{ gridArea: "1 / 1", visibility: busy ? "visible" : "hidden" }}>{pending}</span>
    </span>
  );
}
