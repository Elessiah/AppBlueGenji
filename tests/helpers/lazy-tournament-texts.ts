import frTournamentDialogs from "@/messages/fr/tournamentDialogs.json";
import enTournamentDialogs from "@/messages/en/tournamentDialogs.json";
import { tournamentDialogsText } from "@/lib/shared/tournament-actions-text";
import type { TournamentViewMessages } from "@/lib/shared/tournament-page-text";
import { DIALOGS_TEXT_LOADERS } from "@/app/(secured)/tournois/[id]/_lib/dialogs-text";
import { ENGLISH_ENDURANCE, ENGLISH_ENDURANCE_CHART, ENGLISH_VIEWS } from "@/app/(secured)/tournois/[id]/_lib/view-loaders";
import enTournamentViews from "@/messages/en/tournamentViews.json";
import enTournamentEndurance from "@/messages/en/tournamentEndurance.json";
import enTournamentEnduranceChart from "@/messages/en/tournamentEnduranceChart.json";

/** Les textes des fenêtres, construits comme leurs chargeurs (`dialogs-text.ts`) les rendent. */
export const FR_DIALOGS_TEXT = tournamentDialogsText("fr", frTournamentDialogs);
export const EN_DIALOGS_TEXT = tournamentDialogsText("en", enTournamentDialogs);

/**
 * Amorce les chargeurs des textes chargés à la demande (fenêtres, vues) : un
 * rendu de test synchrone n'a pas de `Suspense` pour attendre leur morceau.
 * Appelé à l'import — un fichier qui rend une fenêtre ou une vue importe ce module.
 */
export function primeLazyTournamentTexts(): void {
  DIALOGS_TEXT_LOADERS.fr.prime(FR_DIALOGS_TEXT);
  DIALOGS_TEXT_LOADERS.en.prime(EN_DIALOGS_TEXT);
  ENGLISH_VIEWS.prime({ swiss: enTournamentViews.swiss, survival: enTournamentViews.survival });
  ENGLISH_ENDURANCE.prime({ endurance: enTournamentEndurance.endurance } as TournamentViewMessages);
  ENGLISH_ENDURANCE_CHART.prime({ endurance: { ...enTournamentEndurance.endurance, ...enTournamentEnduranceChart.endurance } });
}

primeLazyTournamentTexts();
