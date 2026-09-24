import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { purgeQuarantinedLogo } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";

/**
 * Supprime définitivement un logo en quarantaine, avant son échéance — la
 * contestation a été rejetée, ou il n'y a rien à attendre.
 */
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const quarantineId = Number(id);
  if (!Number.isSafeInteger(quarantineId) || quarantineId <= 0) return fail("QUARANTINE_NOT_FOUND", 404);

  try {
    await purgeQuarantinedLogo(quarantineId, { userId: user.id, pseudo: user.pseudo });
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "QUARANTINE_NOT_FOUND") return fail(message, 404);
    if (message === "QUARANTINE_CLOSED") return fail(message, 409);
    console.error("[moderation] suppression du logo en quarantaine impossible", error);
    return fail("LOGO_PURGE_FAILED", 500);
  }
}
