import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";
import { claimMatchCast, releaseMatchCast } from "@/lib/server/tournaments/match-launch";
import {
  isPositiveId,
  launchFailure,
  parseCastTarget,
  parseMatchIdParam,
} from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  NOT_CASTER: 403,
  CASTER_IDENTITY_REQUIRED: 409,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  CASTER_IS_PLAYER: 409,
  STREAM_NOT_FOUND: 409,
  INVALID_STREAM_URL: 400,
  NOT_MATCH_CASTER: 403,
};

/**
 * S'inscrire pour caster un match. Permission `live`, **et** tag Discord
 * certifié **et** compte Battle.net rattaché : le caster se présente aux deux
 * équipes dans la modale de lancement (`lib/shared/match-launch.ts`).
 * Corps : `{ streamId: number }` (co-caster un stream du match) ou
 * `{ liveUrl?: string | null }` (ouvrir son propre stream) — vide : un stream
 * sans lien. Pas de corps du tout : un stream sans lien ; un corps **illisible**
 * (JSON cassé, trop lourd, mauvais type) est refusé, jamais pris pour un corps
 * vide.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  let body: unknown = {};
  if (req.body !== null) {
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return fail(bodyReadRefusal(error) ?? "INVALID_CAST_TARGET", 400);
    }
  }
  const target = parseCastTarget(body);
  if (target === null) return fail("INVALID_CAST_TARGET", 400);

  try {
    await claimMatchCast(matchId, user.id, can(user, "live"), target);
    return ok({ casterUserId: user.id });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_CLAIM_FAILED");
  }
}

/**
 * Se désinscrire — ou, pour l'arbitrage (`tournaments`), retirer un caster du
 * match : `?userId=` le désigne (absent : le lecteur lui-même).
 */
export async function DELETE(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const rawCasterId = new URL(req.url).searchParams.get("userId");
  const casterId = rawCasterId === null ? user.id : Number(rawCasterId);
  if (!isPositiveId(casterId)) return fail("INVALID_USER_ID", 400);

  try {
    await releaseMatchCast(matchId, user.id, can(user, "tournaments"), casterId);
    return ok({ casterUserId: null });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_CAST_RELEASE_FAILED");
  }
}
