import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteTournament } from "@/lib/server/tournaments-service";
import { sendBotLog } from "@/lib/server/bot-integration";

/**
 * Supprime définitivement un tournoi et tout ce qui lui appartient (matchs,
 * inscriptions, classements, phases). Aucune équipe ni aucun joueur n'est
 * touché — voir `lib/server/tournaments/deletion.ts`.
 *
 * Réservé aux **administrateurs**, et non au staff `tournaments` : la
 * suppression n'est pas un acte de gestion de tournoi mais le cran au-dessus,
 * irréversible et sans trace. C'est le seul endroit du projet où le test porte
 * volontairement sur `isAdmin` plutôt que sur une permission scopée.
 */
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (user.isAdmin !== true) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  try {
    const deleted = await deleteTournament(tournamentId);

    // Une suppression définitive ne laisse rien derrière elle : la trace côté
    // bot est le seul journal qui subsiste. L'échec est délibérément avalé — le
    // bot est optionnel, et le tournoi est déjà supprimé : rien à annuler.
    void sendBotLog(
      `🗑️ Tournoi supprimé définitivement : « ${deleted.name} » (#${deleted.id}) par ${user.pseudo} (#${user.id}).`,
    ).catch(() => undefined);

    return ok({ deleted });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    return fail(message || "TOURNAMENT_DELETE_FAILED", 500);
  }
}
