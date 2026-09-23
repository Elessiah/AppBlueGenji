/**
 * Place finale d'une équipe dans un tournoi, en français : « 1er », « 2e »…
 * `null` (tournoi en cours, ou classement non établi) rend un tiret.
 */
export function formatFinalRank(rank: number | null): string {
  if (rank === null || !Number.isInteger(rank) || rank < 1) return "—";
  return rank === 1 ? "1er" : `${rank}e`;
}
