import frTournamentEndurance from "@/messages/fr/tournamentEndurance.json";
import { frTournamentViewText, type TournamentViewMessages } from "@/lib/shared/tournament-page-text";

/**
 * Français de la vue BlueGenji Survie (espace `endurance`, hors graphique) :
 * importé par la vue seule, il ne part qu'avec le morceau d'un tournoi
 * `BG_SURVIE`. Le graphique a le sien (`endurance-chart-text.ts`).
 */
export const FR_ENDURANCE_TEXT = frTournamentViewText({ endurance: frTournamentEndurance.endurance } as TournamentViewMessages);
