import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setUserAdmin } from "@/lib/server/users-service";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) return fail("INVALID_ID", 400);

  // Un admin ne peut pas modifier ses propres droits (évite tout auto-verrouillage).
  if (targetId === user.id) return fail("CANNOT_MODIFY_SELF", 400);

  const body = (await req.json().catch(() => null)) as { isAdmin?: unknown } | null;
  if (typeof body?.isAdmin !== "boolean") return fail("INVALID_PAYLOAD", 400);

  try {
    await setUserAdmin(targetId, body.isAdmin);
    return ok({ isAdmin: body.isAdmin });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg === "USER_NOT_FOUND" ? 404 : 500;
    return fail(msg || "ADMIN_UPDATE_FAILED", status);
  }
}
