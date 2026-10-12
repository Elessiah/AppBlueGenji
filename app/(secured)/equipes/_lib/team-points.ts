import { RANKING_BASE_POINTS, RANKING_FLOOR_POINTS, rankingPointsHintKind } from "@/lib/shared/ranking";
import type { TeamsText } from "@/components/i18n/teams-text";

/**
 * Légende du total de points d'une équipe d'annuaire (`rankingPointsHint`),
 * dans la langue du texte (lot 9). La règle qui choisit la légende reste
 * `rankingPointsHintKind` ; le français égale `rankingPointsHint` (testé).
 */
export function teamPointsHint(text: TeamsText, ranked: boolean, points: number): string {
  const kind = rankingPointsHintKind(ranked, points);
  if (kind === "ranked") return text.t("points.hint", { base: RANKING_BASE_POINTS, floor: RANKING_FLOOR_POINTS });
  return text.t(kind === "unranked" ? "points.unrankedHint" : "points.placementOnlyHint");
}
