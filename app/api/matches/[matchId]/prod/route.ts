import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { claimMatchProd, releaseMatchProd } from "@/lib/server/tournaments/match-prod";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { sessionHolds } from "@/lib/shared/player-view";

const STATUSES: Readonly<Record<string, number>> = {
  NOT_PROD: 403,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  MATCH_PROD_TAKEN: 409,
  PROD_IS_PLAYER: 409,
  PROD_IS_CASTER: 409,
  NOT_MATCH_PROD: 403,
  PLAYER_VIEW_ACTIVE: 403,
};

/**
 * Se placer comme prod du match (`docs/features/MATCH_PROD.md`). Permission
 * `prod`, relue en base sous verrou (403 `NOT_PROD`) ; une place déjà tenue
 * par un autre : 409 `MATCH_PROD_TAKEN`. Aucun corps.
 */
export async function POST(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  // Incarnation sans `prod` (`ADMIN_ROLE_IMPERSONATION.md`) : aucun geste de prod sur cette session.
  if (!sessionHolds(user, "prod")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await claimMatchProd(matchId, user);
    return ok({ prodUserId: user.id });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_PROD_CLAIM_FAILED");
  }
}

/** Quitter sa place de prod du match (403 `NOT_MATCH_PROD` si ce n'est pas la sienne). */
export async function DELETE(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!sessionHolds(user, "prod")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await releaseMatchProd(matchId, user);
    return ok({ prodUserId: null });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_PROD_RELEASE_FAILED");
  }
}
