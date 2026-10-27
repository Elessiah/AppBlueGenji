import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { isPositiveId, launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { loadRefereePanel } from "@/lib/server/tournaments/referee-panel";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  NOT_REFEREE: 409,
  REFEREE_IDENTITY_REQUIRED: 409,
  REFEREE_IS_PLAYER: 409,
};

/**
 * Fenêtre « Arbitrage » d'un match (`docs/features/MATCH_REFEREE.md`) :
 * arbitre désigné nommé, autogestion, première carte, comptes qui peuvent
 * arbitrer. Réservée à l'arbitrage (permission `tournaments`).
 */
export async function GET(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    const panel = await loadRefereePanel(matchId);
    if (!panel) return fail("MATCH_NOT_FOUND", 404);
    return ok({ panel });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_REFEREE_PANEL_FAILED");
  }
}

/**
 * Désigne l'arbitre du match, le remplace ou le retire. Corps :
 * `{ userId: number | null }`. Le compte désigné doit remplir la condition
 * d'arbitrage (409 `NOT_REFEREE` / `REFEREE_IDENTITY_REQUIRED`).
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as { userId?: unknown };
  const refereeId = body.userId ?? null;
  if (refereeId !== null && !isPositiveId(refereeId)) return fail("INVALID_USER_ID", 400);

  try {
    await assignMatchReferee(matchId, user.id, refereeId);
    return ok({ refereeAssigned: refereeId !== null });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_REFEREE_ASSIGN_FAILED");
  }
}
