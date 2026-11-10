import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchReady } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { readOptionalJsonObject } from "@/lib/server/request-body";

const STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  TOURNAMENT_NOT_RUNNING: 409,
  MATCH_ALREADY_LAUNCHED: 409,
  MATCH_NOT_IN_LOBBY: 409,
  NOT_MATCH_PARTY: 403,
  NOT_TEAM_READY_ROLE: 403,
  // Caster devenu inéligible : le motif du blocage du cast.
  NOT_CASTER: 403,
  CASTER_IDENTITY_REQUIRED: 409,
  CASTER_DISCORD_REQUIRED: 409,
};

/**
 * Déclare (`{ ready: true }`) ou retire (`{ ready: false }`) le « Prêt » de la
 * partie du joueur connecté : son équipe (capitaine, manager, propriétaire),
 * son entrée solo, ou le caster inscrit. Le match part quand toutes les parties
 * attendues sont prêtes (`lib/shared/match-launch.ts`).
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  // Un corps trop lourd (413) ou d'un autre type (415) garde son code ; un
  // corps illisible, vide ou sans booléen est un 400 `INVALID_READY_VALUE`.
  const read = await readOptionalJsonObject(req, "INVALID_READY_VALUE");
  if ("refusal" in read) return fail(read.refusal, 400);
  const ready = read.body.ready;
  if (typeof ready !== "boolean") return fail("INVALID_READY_VALUE", 400);

  try {
    return ok(await setMatchReady(matchId, user.id, ready));
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_READY_FAILED");
  }
}
