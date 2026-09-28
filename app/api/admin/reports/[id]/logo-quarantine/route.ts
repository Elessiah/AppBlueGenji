import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { hideTeamLogo, hideUserAvatarForReport } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";

const TEAM_ERRORS = ["TEAM_NOT_TARGETED", "TEAM_HAS_NO_LOGO", "LOGO_CHANGED", "LOGO_NOT_MOVABLE", "LOGO_FILE_MISSING"];
const USER_ERRORS = ["USER_NOT_TARGETED", "USER_HAS_NO_AVATAR", "AVATAR_CHANGED", "AVATAR_NOT_MOVABLE", "AVATAR_FILE_MISSING"];

/**
 * Masque l'image (logo d'équipe ou avatar de joueur) d'une cible visée par ce
 * signalement, dans l'attente d'une contestation
 * (`lib/shared/logo-quarantine.ts`). Corps : `{ targetType: "TEAM" | "USER", targetId: number }`.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) return fail("INVALID_REPORT_ID", 400);
  const body = (await req.json().catch(() => ({}))) as { targetType?: unknown; targetId?: unknown };
  const targetType = body.targetType;
  if (targetType !== "TEAM" && targetType !== "USER") return fail("INVALID_TARGET_TYPE", 400);
  const targetId = Number(body.targetId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return fail("INVALID_TARGET_ID", 400);

  try {
    const quarantine =
      targetType === "TEAM"
        ? await hideTeamLogo(reportId, targetId, { userId: user.id, pseudo: user.pseudo })
        : await hideUserAvatarForReport(reportId, targetId, { userId: user.id, pseudo: user.pseudo });
    return ok({ quarantine }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "REPORT_NOT_FOUND") return fail(message, 404);
    if (TEAM_ERRORS.includes(message) || USER_ERRORS.includes(message)) return fail(message, 409);
    console.error("[moderation] masquage de l'image impossible", error);
    return fail("LOGO_HIDE_FAILED", 500);
  }
}
