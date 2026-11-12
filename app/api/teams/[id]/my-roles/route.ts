import { TEAM_OWN_ROLES_WRITE_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { TEAM_OWN_ROLES_ERROR_STATUS, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { rolesListFromBody } from "@/lib/server/team-invite-roles";
import { updateOwnGameRoles } from "@/lib/server/teams/roster";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * « Mes rôles » : le membre connecté choisit ses propres rôles de jeu (`COACH`,
 * `TANK`, `DPS`, `HEAL` — décision D71). Corps `{ roles: string[] }`, liste
 * vide permise ; ses rôles de direction ne bougent pas (`updateOwnGameRoles`).
 * Rend les rôles enregistrés (`{ roles }`), et non la fiche entière : le client
 * relit déjà la fiche après le geste, et la construire ici (membres,
 * statistiques, historique) doublait ce travail pour une réponse jetée.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  // Avant toute lecture : un client en boucle ne doit pas occuper le pool.
  const throttled = enforceRateLimit(TEAM_OWN_ROLES_WRITE_RULE, user.id);
  if (throttled) return throttled;

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { roles?: unknown };
    const roles = await updateOwnGameRoles(user.id, teamId, rolesListFromBody(body.roles));
    return ok({ roles });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_OWN_ROLES_FAILED", teamErrorStatus(TEAM_OWN_ROLES_ERROR_STATUS, message));
  }
}
