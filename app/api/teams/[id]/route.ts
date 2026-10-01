import { getCurrentUser } from "@/lib/server/auth";
import { DIRECTORY_READ_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { TEAM_DELETE_ERROR_STATUS, TEAM_META_ERROR_STATUS, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { getTeamDetail, softDeleteTeam, updateTeamMeta } from "@/lib/server/teams-service";
import { findSoloEntryUser } from "@/lib/server/solo-entries-service";
import { can } from "@/lib/shared/permissions";
import { INVALID_TEAM_FIELDS, teamFieldsAreText } from "@/lib/shared/team-name";
import { readJsonBody } from "@/lib/server/request-body";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DIRECTORY_READ_RULE, user.id);
  if (throttled) return throttled;

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  // Consultation de la fiche : seul appel qui calcule la place au classement.
  const detail = await getTeamDetail(teamId, user.id, can(user, "tournaments"), true);
  if (!detail) {
    // Une entrée solo est une ligne de `bg_teams` sans fiche d'équipe : son
    // identité publique est le profil du joueur. Un lien vers `/equipes/[id]`
    // reste donc valide — il mène ailleurs, il ne casse pas.
    const soloUserId = await findSoloEntryUser(teamId);
    if (soloUserId !== null) {
      return fail("TEAM_IS_SOLO_ENTRY", 404, { soloUserId });
    }
    return fail("TEAM_NOT_FOUND", 404);
  }

  return ok({ ...detail, canModerate: can(user, "moderation") });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { name?: string; description?: string | null; tag?: string | null };
    if (!teamFieldsAreText(body, ["name", "description", "tag"])) return fail(INVALID_TEAM_FIELDS, 400);
    const managesGhostTeams = can(user, "tournaments");
    await updateTeamMeta(
      user.id,
      teamId,
      { name: body.name, description: body.description, tag: body.tag },
      managesGhostTeams,
    );

    const detail = await getTeamDetail(teamId, user.id, managesGhostTeams);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_UPDATE_FAILED", teamErrorStatus(TEAM_META_ERROR_STATUS, message));
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    await softDeleteTeam(user.id, teamId, can(user, "tournaments"));
    return ok({ deleted: true });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_DELETE_FAILED", teamErrorStatus(TEAM_DELETE_ERROR_STATUS, message));
  }
}
