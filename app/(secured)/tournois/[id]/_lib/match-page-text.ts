import frMatchPage from "@/messages/fr/matchPage.json";
import enMatchPage from "@/messages/en/matchPage.json";
import { useTournamentActionsLocale } from "@/components/i18n/tournament-actions-text";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes propres à la page d'un match (`docs/features/MATCH_PAGE.md`) : en-tête,
 * faits clés, sections. Importés par la page seule (chargée à la demande), ils
 * ne pèsent pas sur ce que la mise en page de la fiche sérialise sous `/en`.
 */
export type MatchPageText = ScopedText<Leaves<typeof frMatchPage>>;

const FR_MATCH_PAGE_TEXT: MatchPageText = scopedText("fr", frMatchPage);
const EN_MATCH_PAGE_TEXT: MatchPageText = scopedText("en", enMatchPage);

/** Textes de la page d'un match, dans la langue de la page. */
export function useMatchPageText(): MatchPageText {
  return useTournamentActionsLocale() === "en" ? EN_MATCH_PAGE_TEXT : FR_MATCH_PAGE_TEXT;
}
