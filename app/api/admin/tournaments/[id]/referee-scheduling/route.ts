import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { setRefereeScheduling } from "@/lib/server/tournaments/referee-scheduling";
import { discordInline } from "@/lib/shared/discord-text";
import { can } from "@/lib/shared/permissions";

/**
 * Allume ou éteint la planification des matchs par l'arbitrage.
 * Corps : `{ enabled: boolean }` — un booléen strict.
 *
 * Réservé à la permission `tournaments` (arbitre, admin) : c'est la même qui
 * pose les horaires — l'option ne fait que rendre ce geste obligatoire. Aucune
 * garde sur l'état en cours, par choix : l'option se modifie **pendant** un
 * tournoi, seul un tournoi terminé la refuse (409).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await readJsonBody(req).catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return fail("INVALID_REFEREE_SCHEDULING", 400);

  try {
    const result = await setRefereeScheduling(tournamentId, body.enabled);
    // Journal seulement sur un vrai changement : un double clic ou une requête
    // rejouée laisserait sinon croire, à l'audit, à deux bascules.
    if (result.changed) {
      publishStaffAction(
        result.enabled
          ? `🗓 Planification par l'arbitrage activée sur « ${discordInline(result.tournamentName)} » par le staff.`
          : `🗓 Planification par l'arbitrage désactivée sur « ${discordInline(result.tournamentName)} » par le staff.`,
        { id: user.id, pseudo: user.pseudo },
      );
    }
    return ok({ enabled: result.enabled, movedToPlanning: result.movedToPlanning });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message === "TOURNAMENT_FINISHED") return fail(message, 409);
    return fail(message || "REFEREE_SCHEDULING_UPDATE_FAILED", 500);
  }
}
