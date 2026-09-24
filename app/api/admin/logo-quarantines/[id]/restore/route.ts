import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { restoreTeamLogo } from "@/lib/server/logo-quarantine";
import { can } from "@/lib/shared/permissions";

/** Rétablit un logo masqué : la contestation a abouti. */
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const quarantineId = Number(id);
  if (!Number.isSafeInteger(quarantineId) || quarantineId <= 0) return fail("QUARANTINE_NOT_FOUND", 404);

  try {
    await restoreTeamLogo(quarantineId, { userId: user.id, pseudo: user.pseudo });
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "QUARANTINE_NOT_FOUND") return fail(message, 404);
    if (["QUARANTINE_CLOSED", "TEAM_HAS_NEW_LOGO", "LOGO_NOT_MOVABLE"].includes(message)) return fail(message, 409);
    console.error("[moderation] rétablissement du logo impossible", error);
    return fail("LOGO_RESTORE_FAILED", 500);
  }
}
