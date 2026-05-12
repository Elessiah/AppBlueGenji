export const TEAM_COLORS = ["#5ac8ff", "#ff9d2e", "#a773ff", "#4fe0a2", "#ff4d5e", "#8fd5ff", "#f5a524"];

export function getPaletteColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}
