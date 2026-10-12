import { INTL_LOCALE } from "@/lib/shared/locales";
import type { TeamPageText } from "@/components/i18n/team-page-text";

/**
 * Place finale d'une équipe dans un tournoi, en français : « 1er », « 2e »…
 * `null` (tournoi en cours, ou classement non établi) rend un tiret.
 */
export function formatFinalRank(rank: number | null): string {
  if (rank === null || !Number.isInteger(rank) || rank < 1) return "—";
  return rank === 1 ? "1er" : `${rank}e`;
}

/**
 * La même place dans la langue du texte (lot 9) : « 1er » / « 1st », « 2e » /
 * « 2nd »… La forme ordinale de la langue (`Intl.PluralRules`, `ordinal`)
 * choisit la terminaison — le formateur réduit n'a pas de `selectordinal`.
 * Le français égale {@link formatFinalRank} (testé).
 */
export function localizedFinalRank(text: TeamPageText, rank: number | null): string {
  if (rank === null || !Number.isInteger(rank) || rank < 1) return "—";
  const form = new Intl.PluralRules(INTL_LOCALE[text.locale], { type: "ordinal" }).select(rank);
  const key = form === "one" || form === "two" || form === "few" ? form : "other";
  return text.t(`history.rank.${key}`, { rank });
}
