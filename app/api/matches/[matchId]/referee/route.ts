import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { releaseMatchReferee, takeMatchReferee } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";
import { sessionHolds } from "@/lib/shared/player-view";

const STATUSES: Readonly<Record<string, number>> = {
  NOT_REFEREE: 403,
  REFEREE_IDENTITY_REQUIRED: 409,
  REFEREE_DISCORD_REQUIRED: 409,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  REFEREE_OBJECTION: 409,
  REFEREE_IS_PLAYER: 409,
  MATCH_ALREADY_REFEREED: 409,
  NOT_MATCH_REFEREE: 403,
  PLAYER_VIEW_ACTIVE: 403,
};

/**
 * « Je prends ce match » : le lecteur devient l'arbitre désigné
 * (`docs/features/MATCH_REFEREE.md`). Permission `tournaments`, tag Discord
 * certifié et, pour un match Overwatch, compte Battle.net rattaché — relus en
 * base sous verrou, le jeu compris.
 */
export async function POST(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("NOT_REFEREE", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await takeMatchReferee(matchId, user);
    return ok({ refereeAssigned: true });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_REFEREE_TAKE_FAILED");
  }
}

/** L'arbitre se retire du match (le staff retire n'importe quel arbitre : route d'administration). */
export async function DELETE(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  // Incarnation sans `tournaments` (`ADMIN_ROLE_IMPERSONATION.md`) : aucun geste d'arbitrage sur cette session.
  if (!sessionHolds(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await releaseMatchReferee(matchId, user, false);
    return ok({ refereeAssigned: false });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_REFEREE_RELEASE_FAILED");
  }
}
