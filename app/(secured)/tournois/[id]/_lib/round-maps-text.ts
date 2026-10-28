import frRoundMaps from "@/messages/fr/roundMaps.json";
import enRoundMaps from "@/messages/en/roundMaps.json";
import { useTournamentActionsLocale } from "@/components/i18n/tournament-actions-text";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes des cartes par manche (`docs/features/ROUND_MAPS.md`) : page du match,
 * bloc de la fiche et fenêtre de réglage. Importés par ces écrans seuls (chargés
 * à la demande), ils ne pèsent pas sur ce que la mise en page sérialise sous `/en`.
 */
export type RoundMapsText = ScopedText<Leaves<typeof frRoundMaps>>;

const FR_ROUND_MAPS_TEXT: RoundMapsText = scopedText("fr", frRoundMaps);
const EN_ROUND_MAPS_TEXT: RoundMapsText = scopedText("en", enRoundMaps);

/** Textes des cartes par manche, dans la langue de la page. */
export function useRoundMapsText(): RoundMapsText {
  return useTournamentActionsLocale() === "en" ? EN_ROUND_MAPS_TEXT : FR_ROUND_MAPS_TEXT;
}
