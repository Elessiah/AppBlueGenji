import type { ReactNode } from "react";

/**
 * Libellé d'un bouton d'envoi qui change pendant la requête (« Enregistrer » →
 * « Enregistrement… »). Les deux textes occupent la **même case** (grille) : le
 * bouton prend la largeur du plus long, il ne bouge pas quand l'envoi part et
 * ne pousse pas ses voisins (375 px, lignes qui passent à la ligne).
 * `visibility: hidden` retire le texte inactif de l'arbre d'accessibilité : le
 * nom du bouton reste le seul libellé visible → `docs/features/BUSY_BUTTONS.md`.
 *
 * L'alternance est dans `globals.css` (`.busy-label`, `data-busy`), pas dans des
 * objets `style` recréés à chaque rendu — le composant se rend à chaque frappe
 * des dialogues qui le portent.
 */
export function BusyLabel({ busy, idle, pending }: Readonly<{ busy: boolean; idle: ReactNode; pending: ReactNode }>) {
  return (
    <span className="busy-label" data-busy={busy || undefined}>
      <span>{idle}</span>
      <span>{pending}</span>
    </span>
  );
}
