/**
 * Libellé d'un bouton d'envoi qui change pendant la requête (« Enregistrer » →
 * « Enregistrement… »). Seul le libellé **actif** est dans le DOM : c'est le
 * nom du bouton et son `textContent`, avec ou sans feuille de style (un test
 * jsdom distingue donc le repos de l'attente, un CSS absent n'affiche pas deux
 * libellés). L'autre est un pseudo-élément invisible (`::after`,
 * `content: attr(data-alt)`, `visibility: hidden`) dans la **même case** de
 * grille : le bouton prend la largeur du plus long, il ne bouge pas quand
 * l'envoi part et ne pousse pas ses voisins (375 px) →
 * `docs/features/BUSY_BUTTONS.md`.
 *
 * Aucun objet `style` recréé à chaque rendu (`globals.css`, `.busy-label`) : le
 * composant se rend à chaque frappe des dialogues qui le portent.
 */
export function BusyLabel({ busy, idle, pending }: Readonly<{ busy: boolean; idle: string; pending: string }>) {
  return (
    <span className="busy-label" data-busy={busy || undefined} data-alt={busy ? idle : pending}>
      <span>{busy ? pending : idle}</span>
    </span>
  );
}
