import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { hideTeamLogo } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";

/**
 * Masque le logo d'une équipe visée par ce signalement, dans l'attente d'une
 * contestation (`lib/shared/logo-quarantine.ts`). Corps : `{ teamId: number }`.
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
    const quarantine = await hideTeamLogo(reportId, teamId, { userId: user.id, pseudo: user.pseudo });
    return ok({ quarantine }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "REPORT_NOT_FOUND") return fail(message, 404);
    if (["TEAM_NOT_TARGETED", "TEAM_HAS_NO_LOGO", "LOGO_CHANGED", "LOGO_NOT_MOVABLE"].includes(message)) {
      return fail(message, 409);
    }
    console.error("[moderation] masquage du logo impossible", error);
    return fail("LOGO_HIDE_FAILED", 500);
  }
}
