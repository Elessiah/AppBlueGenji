import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getFullProfile } from "@/lib/server/users-service";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return fail("INVALID_ID", 400);
  }

  const profile = await getFullProfile(user.id, targetId);
  if (!profile) return fail("PLAYER_NOT_FOUND", 404);

  return ok(profile);
}
