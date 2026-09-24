import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchHost } from "@/lib/server/tournaments/match-launch";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  INVALID_HOST_TEAM: 400,
};

/**
 * Désigne l'équipe qui héberge la partie. Corps : `{ teamId: number | null }` —
 * `null` rend la main au défaut (équipe 1). Réservé à l'arbitrage.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await req.json().catch(() => ({}))) as { teamId?: unknown };
  const raw = body.teamId ?? null;
  if (raw !== null && (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0)) {
    return fail("INVALID_HOST_TEAM", 400);
  }

  try {
    await setMatchHost(matchId, raw);
    return ok({ hostTeamId: raw });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_HOST_UPDATE_FAILED");
  }
}
