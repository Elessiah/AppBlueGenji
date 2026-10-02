import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { claimGhostTeam } from "@/lib/server/ghost-teams-service";
import { getUserIdByPseudo } from "@/lib/server/users/roles";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * **Propose** une équipe fantôme à un joueur réel. Réservé à la permission
 * `tournaments`. Rien n'est attribué ici : le joueur reçoit une invitation, et
 * ce n'est qu'en l'acceptant qu'il devient OWNER et que l'équipe cesse d'être
 * fantôme (`claimGhostTeam`). Sans cela, un arbitre pouvait faire d'un free
 * agent l'engagé d'un tournoi vivant — et lire ainsi ses contacts — sans qu'il
 * ait rien demandé.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const body = (await readJsonBody(req)) as { pseudo?: string };
    const pseudo = (body.pseudo ?? "").trim();
    if (!pseudo) return fail("INVALID_PSEUDO", 400);

    const newOwnerId = await getUserIdByPseudo(pseudo);
    if (!newOwnerId) return fail("USER_NOT_FOUND", 404);

    await claimGhostTeam(teamId, newOwnerId, user.id);
    return ok({ success: true, invitedUserId: newOwnerId });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TEAM_NOT_FOUND" || message === "USER_NOT_FOUND") return fail(message, 404);
    if (
      message === "NOT_A_GHOST_TEAM"
      || message === "USER_ALREADY_IN_TEAM"
      || message === "GHOST_CLAIM_ALREADY_PROPOSED"
    ) {
      return fail(message, 409);
    }
    if (message === "TEAM_ALREADY_DELETED") return fail(message, 409);
    return fail(message || "TEAM_CLAIM_FAILED", 400);
  }
}
