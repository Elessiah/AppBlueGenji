import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteTeamLogoForReport } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";

/**
 * Supprime **sans délai** le logo d'une équipe visée par ce signalement — un
 * contenu manifestement illicite (`deleteTeamLogoForReport`). La décision est
 * rattachée au signalement et l'équipe est prévenue, avec le lien pour la
 * contester. Corps : `{ teamId: number }`.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) return fail("INVALID_REPORT_ID", 400);
  const body = (await req.json().catch(() => ({}))) as { teamId?: unknown };
  const teamId = Number(body.teamId);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM_ID", 400);

  try {
    const removal = await deleteTeamLogoForReport(reportId, teamId, { userId: user.id, pseudo: user.pseudo });
    return ok({ removal }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "REPORT_NOT_FOUND") return fail(message, 404);
    if (message === "TEAM_NOT_TARGETED" || message === "TEAM_HAS_NO_LOGO") return fail(message, 409);
    console.error("[moderation] suppression du logo impossible", error);
    return fail("TEAM_LOGO_REMOVE_FAILED", 500);
  }
}
