import { getCurrentUser } from "@/lib/server/auth";
import {
  DIRECTORY_READ_RULE,
  enforceRateLimit,
  reserveRateLimit,
  reserveTeamIdentityWrite,
  TEAM_LIFECYCLE_RULE,
} from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { TEAM_DELETE_ERROR_STATUS, TEAM_META_ERROR_STATUS, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { getTeamDetail } from "@/lib/server/teams/detail";
import { softDeleteTeam } from "@/lib/server/teams/dissolution";
import { updateTeamMeta } from "@/lib/server/teams/identity";
import { findSoloEntryUser } from "@/lib/server/solo-entries-service";
import { loadProfilelessPlayerIds } from "@/lib/server/users/profileless-players";
import { can } from "@/lib/shared/permissions";
import { INVALID_TEAM_FIELDS, teamFieldsAreText } from "@/lib/shared/team-name";
import { readJsonBody } from "@/lib/server/request-body";
import { isRightsRefusal } from "@/lib/server/team-route-errors";

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
    // Sauf un compte supprimé **sans fiche** (D13) : la redirection mènerait à
    // une page introuvable — l'entrée n'a alors nulle part où mener.
    const soloUserId = await findSoloEntryUser(teamId);
    if (soloUserId !== null && !(await loadProfilelessPlayerIds()).includes(soloUserId)) {
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

  // Plafond des écritures d'identité d'un compte (renommage en boucle) ; le
  // staff `tournaments` (équipes fantômes) n'y est pas soumis.
  const managesGhostTeams = can(user, "tournaments");
  // Une écriture refusée avant d'avoir eu lieu (corps invalide, nom ou sigle
  // pris, droit manquant) rend sa place : seule une écriture faite compte.
  const reservation = reserveTeamIdentityWrite(user.id, managesGhostTeams);
  if (reservation.refused) return reservation.refused;

  try {
    let body: { name?: string; description?: string | null; tag?: string | null };
    try {
      body = (await readJsonBody(req)) as typeof body;
      if (!teamFieldsAreText(body, ["name", "description", "tag"])) {
        reservation.refund();
        return fail(INVALID_TEAM_FIELDS, 400);
      }
      await updateTeamMeta(
        user.id,
        teamId,
        { name: body.name, description: body.description, tag: body.tag },
        managesGhostTeams,
      );
      // Un patch vide n'écrit rien (droit jugé quand même) : il rend sa place.
      if (body.name === undefined && body.description === undefined && body.tag === undefined) {
        reservation.refund();
      }
    } catch (error) {
      // `updateTeamMeta` ne lève qu'avant son commit (ce qui suit ne lève pas).
      // Un refus de droit, lui, garde sa place : un compte sans qualité qui
      // boucle sur les équipes des autres reste plafonné.
      if (!isRightsRefusal(error)) reservation.refund();
      throw error;
    }

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

  // Plafond des créations et dissolutions d'un compte ; le staff `tournaments`
  // (équipes fantômes) n'y est pas soumis.
  const capped = !can(user, "tournaments");
  // Réservée en une instruction, rendue si la dissolution est refusée (sauf
  // refus de droit) — et
  // seulement alors : `softDeleteTeam` ne lève qu'avant son commit (ce qui suit
  // le commit, effacement du logo compris, ne lève jamais).
  const reservation = capped ? reserveRateLimit(TEAM_LIFECYCLE_RULE, user.id) : null;
  if (reservation?.refused) return reservation.refused;

  try {
    await softDeleteTeam(user.id, teamId, can(user, "tournaments"));
    return ok({ deleted: true });
  } catch (error) {
    // Comme les écritures d'identité : un refus de droit garde sa place — un
    // compte sans qualité qui boucle sur les équipes des autres reste plafonné.
    if (!isRightsRefusal(error)) reservation?.refund();
    const message = (error as Error).message;
    return fail(message || "TEAM_DELETE_FAILED", teamErrorStatus(TEAM_DELETE_ERROR_STATUS, message));
  }
}
