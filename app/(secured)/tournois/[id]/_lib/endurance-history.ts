import type { EnduranceRoundCell } from "@/lib/shared/bg-survie";

/**
 * Lecture du tableau d'endurance **manche par manche** — la vue « feuille de
 * calcul » du mode BlueGenji Survie.
 *
 * Module pur : il ne décide que de ce qu'une case dit et du poids qu'elle a.
 * Le composant n'a plus qu'à traduire le ton en classe CSS, ce qui laisse la
 * règle — « une équipe retirée porte FF, pas un capital » — testable sans rendu.
 */

/**
 * Poids d'une case, indépendant de la feuille de style :
 *
 * - `POINTS` — capital courant, lecture ordinaire ;
 * - `ZERO` — capital vidé : c'est encore un nombre, mais il ne se lit plus
 *   comme un score sain ;
 * - `FORFEIT` — forfait sur le reste du tournoi : case rouge portant « FF » ;
 * - `OUT` — manche que l'équipe, déjà éliminée, n'a pas disputée.
 */
export type EnduranceCellTone = "POINTS" | "ZERO" | "FORFEIT" | "OUT";

export function enduranceCellTone(cell: EnduranceRoundCell): EnduranceCellTone {
  if (cell.kind === "FORFEIT") return "FORFEIT";
  if (cell.kind === "OUT") return "OUT";
  return cell.points === 0 ? "ZERO" : "POINTS";
}

/**
 * Contenu de la case. « FF » plutôt qu'un 0 pour une équipe retirée : les deux
 * situations mènent au même capital, mais pas au même récit — et c'est
 * précisément ce que le tableau doit distinguer.
 */
export function enduranceCellLabel(cell: EnduranceRoundCell): string {
  if (cell.kind === "FORFEIT") return "FF";
  if (cell.kind === "OUT") return "—";
  return String(cell.points ?? 0);
}

/**
 * Phrase complète de la case, pour l'infobulle : une grille de nombres sans
 * en-têtes lisibles au survol ne se relit pas, et « FF » seul ne se comprend
 * qu'une fois la légende trouvée.
 */
export function enduranceCellTitle(teamName: string, cell: EnduranceRoundCell): string {
  const prefix = `${teamName} · manche ${cell.round}`;

  if (cell.kind === "FORFEIT") return `${prefix} : forfait sur le reste du tournoi`;
  if (cell.kind === "OUT") return `${prefix} : déjà éliminée`;

  const points = cell.points ?? 0;
  return `${prefix} : ${points} point${points > 1 ? "s" : ""} d'endurance`;
}

/**
 * Gabarit de grille du tableau : le nom de l'équipe, puis une colonne fixe par
 * manche.
 *
 * Il voyage dans une variable CSS (`--history-cols`) et non en
 * `grid-template-columns` en ligne : le nombre de manches n'est connu qu'au
 * rendu, mais une déclaration en ligne l'emporterait sur toute règle de la
 * feuille de style, media query comprise.
 *
 * Aucune manche → la seule colonne d'équipe. `repeat()` exige une multiplicité
 * **positive** : un `repeat(0, 40px)` ferait rejeter la déclaration entière par
 * le moteur CSS, et la grille retomberait sur une colonne implicite sans que
 * rien ne le signale.
 */
export function enduranceHistoryColumns(roundCount: number): string {
  const rounds = Math.max(0, Math.floor(roundCount));
  if (rounds === 0) return "minmax(140px, 1fr)";
  return `minmax(140px, 1fr) repeat(${rounds}, 40px)`;
}
