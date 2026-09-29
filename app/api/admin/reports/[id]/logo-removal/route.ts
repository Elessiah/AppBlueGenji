import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteTeamLogoForReport, deleteUserAvatarForReport } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * Supprime **sans délai** l'image (logo d'équipe ou avatar de joueur) d'une
 * cible visée par ce signalement — un contenu manifestement illicite
 * (`deleteTeamLogoForReport` / `deleteUserAvatarForReport`). La décision est
 * rattachée au signalement et la personne concernée est prévenue, avec le lien
 * pour la contester. Corps : `{ targetType: "TEAM" | "USER", targetId: number }`.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) return fail("INVALID_REPORT_ID", 400);
  const body = (await readJsonBody(req).catch(() => ({}))) as { targetType?: unknown; targetId?: unknown };
  const targetType = body.targetType;
  if (targetType !== "TEAM" && targetType !== "USER") return fail("INVALID_TARGET_TYPE", 400);
  const targetId = Number(body.targetId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return fail("INVALID_TARGET_ID", 400);

  try {
    const removal =
      targetType === "TEAM"
        ? await deleteTeamLogoForReport(reportId, targetId, { userId: user.id, pseudo: user.pseudo })
        : await deleteUserAvatarForReport(reportId, targetId, { userId: user.id, pseudo: user.pseudo });
    return ok({ removal }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "REPORT_NOT_FOUND") return fail(message, 404);
    if (["TEAM_NOT_TARGETED", "TEAM_HAS_NO_LOGO", "USER_NOT_TARGETED", "USER_HAS_NO_AVATAR"].includes(message)) {
      return fail(message, 409);
    }
    console.error("[moderation] suppression de l'image impossible", error);
    return fail("TEAM_LOGO_REMOVE_FAILED", 500);
  }
}
