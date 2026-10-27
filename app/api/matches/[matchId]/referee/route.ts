import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { releaseMatchReferee, takeMatchReferee } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  NOT_REFEREE: 403,
  REFEREE_IDENTITY_REQUIRED: 409,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  REFEREE_IS_PLAYER: 409,
  MATCH_ALREADY_REFEREED: 409,
  NOT_MATCH_REFEREE: 403,
};

/**
 * « Je prends ce match » : le lecteur devient l'arbitre désigné
 * (`docs/features/MATCH_REFEREE.md`). Permission `tournaments`, tag Discord
 * certifié et compte Battle.net rattaché — relus en base sous verrou.
 */
export async function POST(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("NOT_REFEREE", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await takeMatchReferee(matchId, user.id);
    return ok({ refereeAssigned: true });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_REFEREE_TAKE_FAILED");
  }
}

/** L'arbitre se retire du match (le staff retire n'importe quel arbitre : route d'administration). */
export async function DELETE(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await releaseMatchReferee(matchId, user.id, false);
    return ok({ refereeAssigned: false });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_REFEREE_RELEASE_FAILED");
  }
}
