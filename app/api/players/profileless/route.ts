import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { DIRECTORY_READ_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { profilelessAmong } from "@/lib/server/users/profileless-players";
import { parseProfilelessLookup } from "@/lib/shared/profileless-lookup";

/**
 * Parmi les comptes **affichés** par la page (`?ids=3,8`, au plus
 * `PROFILELESS_LOOKUP_MAX`), ceux qui sont supprimés sans fiche (D13), pour que
 * `ProfilelessPlayersProvider` rende leur nom en texte. Jamais la liste entière
 * (D86). Au seul visiteur connecté, le seul à qui un nom mène quelque part.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DIRECTORY_READ_RULE, user.id);
  if (throttled) return throttled;

  const ids = parseProfilelessLookup(request.nextUrl.searchParams.get("ids"));
  if (ids === null) return fail("INVALID_PLAYER_IDS", 400);

  return ok({ ids: await profilelessAmong(ids) });
}
