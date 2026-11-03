import frTournamentEndurance from "@/messages/fr/tournamentEndurance.json";
import frTournamentEnduranceChart from "@/messages/fr/tournamentEnduranceChart.json";
import { frTournamentViewText } from "@/lib/shared/tournament-page-text";

/**
 * Français du graphique de BlueGenji Survie : ses clés (`endurance.chart*`)
 * ne partent qu'avec son morceau, volet ouvert ; il lit aussi celles de la vue
 * (`endurance.penaltyBadge*`), déjà chargées avec elle.
 */
export const FR_ENDURANCE_CHART_TEXT = frTournamentViewText({
  endurance: { ...frTournamentEndurance.endurance, ...frTournamentEnduranceChart.endurance },
});
