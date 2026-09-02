import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createTeam, getUserActiveTeam, listTeams } from "@/lib/server/teams-service";
import { createGhostTeam } from "@/lib/server/ghost-teams-service";
import { can } from "@/lib/shared/permissions";
import { TEAM_TAG_ALREADY_USED, checkTeamTag } from "@/lib/shared/team-tag";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const teams = await listTeams();
  const activeTeam = await getUserActiveTeam(user.id);

  // Pilote l'affichage des contrôles d'équipes fantômes côté client.
  return ok({ teams, activeTeam, canManageGhostTeams: can(user, "tournaments") });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string | null;
      tag?: string | null;
      ghost?: boolean;
    };
    const name = (body.name ?? "").trim();

    if (name.length < 3 || name.length > 60) {
      return fail("INVALID_TEAM_NAME", 400);
    }

    // Forme du sigle contrôlée ici, avant toute écriture : le refus dit lequel
    // des trois défauts corriger, et le service n'a plus à s'en soucier.
    const tagCheck = checkTeamTag(body.tag);
    if (!tagCheck.ok) return fail(tagCheck.reason, 400);

    // Équipe fantôme : réservée au staff tournois, et sans membre — l'auteur
    // n'en devient donc pas propriétaire et garde son équipe active.
    if (body.ghost === true) {
      if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
      const ghostTeamId = await createGhostTeam(name, body.description ?? null, tagCheck.tag);
      return ok({ teamId: ghostTeamId, ghost: true }, 201);
    }

    const teamId = await createTeam(user.id, name, body.description ?? null, tagCheck.tag);
    return ok({ teamId }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    // Avant le repli sur le nom : `bg_teams` porte deux uniques, et une
    // collision de sigle annoncée comme un nom déjà pris enverrait corriger le
    // mauvais champ.
    if (message === TEAM_TAG_ALREADY_USED) return fail(message, 409);
    if (message.includes("Duplicate") || message.includes("duplicate")) return fail("TEAM_NAME_ALREADY_USED", 409);
    return fail(message || "TEAM_CREATE_FAILED", 400);
  }
}
