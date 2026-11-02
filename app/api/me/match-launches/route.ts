import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_LAUNCH_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { listViewerMatchLaunches } from "@/lib/server/tournaments/match-launch-info";
import { dispatchMatchVoiceChannels } from "@/lib/server/tournaments/match-voice";

/**
 * Matchs du joueur connecté à présenter dans la modale de lancement : ceux
 * qu'il joue ou caste, dont l'heure approche, qui sont en lancement ou qui se
 * jouent (`lib/shared/match-launch.ts`). Interrogée par la modale globale.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(MATCH_LAUNCH_READ_RULE, user.id);
  if (throttled) return throttled;

  // Les salons vocaux d'équipe se comptent au rythme de la modale (`./match-voice`).
  void dispatchMatchVoiceChannels();
  try {
    const launches = await listViewerMatchLaunches(user);
    return ok({ launches });
  } catch (error) {
    console.error("[match-launch] lecture impossible", error);
    return fail("MATCH_LAUNCH_READ_FAILED", 500);
  }
}
