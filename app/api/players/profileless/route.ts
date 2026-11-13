import { getCurrentUser } from "@/lib/server/auth";
import { DIRECTORY_READ_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { loadProfilelessPlayerIds } from "@/lib/server/users/profileless-players";

/**
 * Les comptes supprimés sans fiche (D13), relus par `ProfilelessPlayersProvider`
 * à la navigation client : la mise en page racine, qui les pose au chargement,
 * n'est pas re-rendue d'un lien à l'autre. Au seul visiteur connecté, comme elle.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DIRECTORY_READ_RULE, user.id);
  if (throttled) return throttled;

  return ok({ ids: await loadProfilelessPlayerIds() });
}
