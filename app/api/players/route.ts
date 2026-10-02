import { getCurrentUser } from "@/lib/server/auth";
import { DIRECTORY_READ_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { listPlayers } from "@/lib/server/users/players";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DIRECTORY_READ_RULE, user.id);
  if (throttled) return throttled;

  const players = await listPlayers(user.id);
  return ok({ players });
}
