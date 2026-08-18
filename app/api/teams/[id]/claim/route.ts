import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { claimGhostTeam } from "@/lib/server/ghost-teams-service";
import { getUserIdByPseudo } from "@/lib/server/users-service";
import { can } from "@/lib/shared/permissions";

/**
 * Attribue une équipe fantôme à un joueur réel : il en devient OWNER et
 * l'équipe cesse d'être fantôme. Réservé à la permission `tournaments`.
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
    const body = (await req.json()) as { pseudo?: string };
    const pseudo = (body.pseudo ?? "").trim();
    if (!pseudo) return fail("INVALID_PSEUDO", 400);

    const newOwnerId = await getUserIdByPseudo(pseudo);
    if (!newOwnerId) return fail("USER_NOT_FOUND", 404);

    await claimGhostTeam(teamId, newOwnerId);
    return ok({ success: true, ownerUserId: newOwnerId });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TEAM_NOT_FOUND" || message === "USER_NOT_FOUND") return fail(message, 404);
    if (message === "NOT_A_GHOST_TEAM" || message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    if (message === "TEAM_ALREADY_DELETED") return fail(message, 409);
    return fail(message || "TEAM_CLAIM_FAILED", 400);
  }
}
