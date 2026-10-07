import frTournamentViews from "@/messages/fr/tournamentViews.json";
import { frTournamentViewText } from "@/lib/shared/tournament-page-text";

/**
 * Français des vues chargées à la demande (ronde suisse, survie par coupes,
 * BlueGenji Survie) : importé par les vues seules, il voyage avec leurs
 * morceaux `dynamic()` plutôt qu'avec le premier chargement de la fiche. Un
 * seul texte pour les trois — le JSON est un module unique pour le bundler, et
 * une vue peut lire la clé d'une autre (`swiss.team` dans l'endurance).
 */
export const FR_VIEWS_TEXT = frTournamentViewText({
  swiss: frTournamentViews.swiss,
  survival: frTournamentViews.survival,
  endurance: frTournamentViews.endurance,
});
