import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_LAUNCH_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { anyTournamentRunning, listViewerMatchLaunches } from "@/lib/server/tournaments/match-launch-info";
import { dispatchLobbyBriefs } from "@/lib/server/tournaments/lobby-brief";
import { dispatchMatchVoiceChannels } from "@/lib/server/tournaments/match-voice";
import { failureReason } from "@/lib/server/failure-reason";

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

  // Les salons vocaux d'équipe se créent et se rendent au rythme de la modale
  // (`./match-voice`) — même sans tournoi en cours : un salon resté ouvert
  // après la fin doit encore être rendu (le balayage s'arrête de lui-même sur
  // deux lectures d'index quand il n'a rien à faire).
  void dispatchMatchVoiceChannels();
  // Et le check-in du match (`./lobby-brief`), dû 15 minutes avant l'horaire :
  // les joueurs proches de leur match interrogent cette route, pas forcément la
  // liste. Sans tournoi en cours (lecture mutualisée), aucun match à briefer.
  void anyTournamentRunning()
    .then((running) => (running ? dispatchLobbyBriefs() : 0))
    .catch(() => undefined);
  try {
    const launches = await listViewerMatchLaunches(user);
    return ok({ launches });
  } catch (error) {
    console.error("[match-launch] lecture impossible", failureReason(error));
    return fail("MATCH_LAUNCH_READ_FAILED", 500);
  }
}
