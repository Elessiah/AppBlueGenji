import { finalRankLabel } from "@/lib/shared/ordinal";
import type { TeamPageText } from "@/components/i18n/team-page-text";

/**
 * Place finale d'une équipe dans la langue du texte (lot 9) : « 1er » / « 1st »,
 * « 2e » / « 2nd »… `null` (tournoi en cours, ou classement non établi) rend
 * un tiret.
 */
export function localizedFinalRank(text: TeamPageText, rank: number | null): string {
  return finalRankLabel(text.locale, rank, (form, value) => text.t(`history.rank.${form}`, { rank: value }));
}
