import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { claimMatchCast, releaseMatchCast } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  NOT_CASTER: 403,
  CASTER_IDENTITY_REQUIRED: 409,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  CASTER_IS_PLAYER: 409,
  MATCH_ALREADY_CASTED: 409,
  NOT_MATCH_CASTER: 403,
};

/**
 * S'inscrire pour caster un match. Permission `live`, **et** tag Discord
 * certifié **et** compte Battle.net rattaché : le caster se présente aux deux
 * équipes dans la modale de lancement (`lib/shared/match-launch.ts`).
 */
export async function POST(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await claimMatchCast(matchId, user.id, can(user, "live"));
    return ok({ casterUserId: user.id });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_CLAIM_FAILED");
  }
}

/**
 * Se désinscrire — ou, pour l'arbitrage (`tournaments`), retirer le caster
 * d'un match.
 */
export async function DELETE(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    await releaseMatchCast(matchId, user.id, can(user, "tournaments"));
    return ok({ casterUserId: null });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_RELEASE_FAILED");
  }
}
