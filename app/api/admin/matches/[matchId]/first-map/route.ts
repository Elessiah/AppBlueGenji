import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { setMatchFirstMap } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_FIRST_MAP: 400,
  INVALID_MAP_PICK: 400,
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
};

/**
 * Fixe la première carte du match (`docs/features/MATCH_REFEREE.md`). Corps :
 * `{ map: string | null }` — `null` ou vide la retire. Réservé à l'arbitrage.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as { map?: unknown };

  try {
    await setMatchFirstMap(matchId, body.map ?? null);
    return ok({});
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_FIRST_MAP_FAILED");
  }
}
