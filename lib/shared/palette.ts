/**
 * Teintes des emblèmes de l'annuaire (cartes d'équipe et de joueur), une par
 * identifiant. Néons froids seulement (DESIGN_SYSTEM.md § Palette « néon
 * froid ») : glacier, violet, cyan, vert d'eau, rose — aucun orange, ambre ni
 * rouge, réservé au direct. Valeurs littérales des jetons de `globals.css`
 * (`--blue-500`, `--violet-400`, `--cyan-400`, `--teal-400`, `--pink-400`,
 * `--blue-300`, `--violet-300`) : elles servent aussi dans `color-mix()`.
 */
export const TEAM_COLORS = ["#5ac8ff", "#a78bfa", "#3ee6ff", "#3ee8b0", "#f78ad8", "#8fd5ff", "#c4b5fd"];

export function getPaletteColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}
