import frTournamentViews from "@/messages/fr/tournamentViews.json";
import { frTournamentViewText } from "@/lib/shared/tournament-page-text";

/**
 * Français des vues chargées à la demande de la ronde suisse et de la survie
 * par coupes : importé par ces vues seules, il voyage avec leurs morceaux
 * `dynamic()` plutôt qu'avec le premier chargement de la fiche. BlueGenji
 * Survie a le sien (`endurance-text.ts`), dans un autre fichier : un JSON est
 * un seul module pour le bundler, et ses textes partaient sinon avec ces vues.
 */
export const FR_VIEWS_TEXT = frTournamentViewText({
  swiss: frTournamentViews.swiss,
  survival: frTournamentViews.survival,
});
