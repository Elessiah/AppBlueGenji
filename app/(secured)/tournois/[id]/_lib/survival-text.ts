import frTournamentViews from "@/messages/fr/tournamentViews.json";
import { frTournamentViewText } from "@/lib/shared/tournament-page-text";

/**
 * Français de la survie par coupes : importé par la vue seule, il voyage avec son
 * morceau chargé à la demande plutôt qu'avec le premier chargement de la fiche
 * (`docs/features/I18N.md` § lot 8a-2, Performance).
 */
export const FR_SURVIVAL_TEXT = frTournamentViewText({ survival: frTournamentViews.survival });
