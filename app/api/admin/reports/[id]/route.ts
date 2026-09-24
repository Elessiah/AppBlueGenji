import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { applyReportAction } from "@/lib/server/content-reports";
import { isReportAction } from "@/lib/shared/content-reports";
import { can } from "@/lib/shared/permissions";

/**
 * Geste du panneau sur un signalement : prendre en charge, remettre en
 * attente, résoudre (archiver) ou rouvrir.
 *
 * Corps : `{ action: "TAKE" | "RELEASE" | "RESOLVE" | "REOPEN", note?: string }`
 * — la note n'est lue qu'à la résolution.
 */
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) return fail("INVALID_REPORT_ID", 400);

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
  if (!isReportAction(body.action)) return fail("INVALID_REPORT_ACTION", 400);

  try {
    await applyReportAction(
      reportId,
      body.action,
      { userId: user.id, pseudo: user.pseudo },
      typeof body.note === "string" ? body.note : null,
    );
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "REPORT_NOT_FOUND") return fail(message, 404);
    if (message === "REPORT_ACTION_NOT_ALLOWED") return fail(message, 409);
    console.error("[reports] geste impossible", error);
    return fail("REPORT_ACTION_FAILED", 500);
  }
}
