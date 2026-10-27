import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { setMatchSelfManaged } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
};

/**
 * Passe le match en autogestion, ou l'en sort (`docs/features/MATCH_REFEREE.md`).
 * Corps : `{ enabled: boolean }`. L'allumer retire l'arbitre désigné. Réservé
 * à l'arbitrage.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return fail("INVALID_SELF_MANAGEMENT", 400);

  try {
    await setMatchSelfManaged(matchId, body.enabled);
    return ok({ selfManaged: body.enabled });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_SELF_MANAGEMENT_FAILED");
  }
}
