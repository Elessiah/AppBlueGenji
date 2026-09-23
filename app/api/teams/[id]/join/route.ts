import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getTeamDetail, requestToJoinTeam } from "@/lib/server/teams-service";
import { JOIN_CONFLICTS } from "@/lib/server/team-invite-roles";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const result = await requestToJoinTeam(user.id, teamId);
    const detail = await getTeamDetail(teamId, user.id);
    return ok({ result, ...detail });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    if (message === "ALREADY_REQUESTED") return fail(message, 409);
    if (message === "TEAM_NOT_FOUND") return fail(message, 404);
    // Fantôme ou entrée solo : la ligne existe, mais elle ne se rejoint pas.
    if (message === "TEAM_NOT_JOINABLE") return fail(message, 409);
    // Invitation acceptée par la demande (`acceptIntoTeam`) : un état qui a
    // changé entre la lecture et l'écriture est un conflit, pas une saisie.
    if (JOIN_CONFLICTS.has(message)) return fail(message, 409);
    return fail(message || "TEAM_JOIN_FAILED", 400);
  }
}
