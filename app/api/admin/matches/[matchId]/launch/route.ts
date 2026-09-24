import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { forceLaunchMatch } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  TOURNAMENT_NOT_RUNNING: 409,
  MATCH_ALREADY_LAUNCHED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
};

/**
 * Lance un match sans attendre les « Prêt » manquants. Réservé à l'arbitrage
 * (`tournaments`) : c'est le recours contre une partie absente.
 */
export async function POST(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await forceLaunchMatch(matchId);
    return ok({ launched: true });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_LAUNCH_FAILED");
  }
}
