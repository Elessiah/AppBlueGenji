import { REFEREE_SCHEDULING_TOGGLE_RULE } from "@/lib/server/api-guard";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { putTournamentToggle } from "@/lib/server/tournament-toggle-route";
import { setRefereeScheduling } from "@/lib/server/tournaments/referee-scheduling";
import { discordInline } from "@/lib/shared/discord-text";

/**
 * Allume ou éteint la planification des matchs par l'arbitrage.
 * Corps : `{ enabled: boolean }` — un booléen strict.
 *
 * Réservé à la permission `tournaments` (arbitre, admin) : c'est la même qui
 * pose les horaires — l'option ne fait que rendre ce geste obligatoire. Aucune
 * garde sur l'état en cours, par choix : l'option se modifie **pendant** un
 * tournoi, seul un tournoi terminé la refuse (409). Débit plafonné par compte
 * (`REFEREE_SCHEDULING_TOGGLE_RULE`). Déroulé commun : `putTournamentToggle` ;
 * la réponse ajoute `movedToPlanning`. Journal seulement sur un vrai changement :
 * un double clic ou une requête rejouée laisserait sinon croire, à l'audit, à
 * deux bascules.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return putTournamentToggle(req, context, {
    rule: REFEREE_SCHEDULING_TOGGLE_RULE,
    invalidCode: "INVALID_REFEREE_SCHEDULING",
    failedCode: "REFEREE_SCHEDULING_UPDATE_FAILED",
    apply: (tournamentId, enabled) => setRefereeScheduling(tournamentId, enabled),
    announce: (result, tournamentId, user) =>
      publishStaffAction(
        result.enabled
          ? `🗓 Planification par l'arbitrage activée sur « ${discordInline(result.tournamentName)} » par le staff.`
          : `🗓 Planification par l'arbitrage désactivée sur « ${discordInline(result.tournamentName)} » par le staff.`,
        { id: user.id, pseudo: user.pseudo },
        { category: "referees", tournamentId },
      ),
    extra: (result) => ({ movedToPlanning: result.movedToPlanning }),
  });
}
