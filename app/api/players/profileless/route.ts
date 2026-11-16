import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, PROFILELESS_LOOKUP_RULE } from "@/lib/server/api-guard";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { profilelessAmong } from "@/lib/server/users/profileless-players";
import { parseProfilelessLookup } from "@/lib/shared/profileless-lookup";

/**
 * Parmi les comptes **affichés** par la page (`?ids=3,8`, au plus
 * `PROFILELESS_LOOKUP_MAX`), ceux qui sont supprimés sans fiche (D13), pour que
 * `ProfilelessPlayersProvider` rende leur nom en texte. Jamais la liste entière
 * (D86). Au seul visiteur connecté, le seul à qui un nom mène quelque part,
 * sous son propre seau (`PROFILELESS_LOOKUP_RULE`, distinct de l'annuaire).
 * Liste illisible : 503 (`PROFILELESS_UNAVAILABLE`), jamais une réponse vide
 * que les liens prendraient pour « tous ont une fiche ».
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(PROFILELESS_LOOKUP_RULE, user.id);
  if (throttled) return throttled;

  const ids = parseProfilelessLookup(request.nextUrl.searchParams.get("ids"));
  if (ids === null) return fail("INVALID_PLAYER_IDS", 400);

  try {
    return ok({ ids: await profilelessAmong(ids) });
  } catch (error) {
    console.error("[profileless-players] liste illisible", failureReason(error));
    return fail("PROFILELESS_UNAVAILABLE", 503);
  }
}
