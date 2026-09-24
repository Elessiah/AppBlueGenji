import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchReplayUrl } from "@/lib/server/tournaments/match-replay";
import { can } from "@/lib/shared/permissions";

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Pose (ou efface) le lien YouTube de la rediff d'un match terminé.
 * Corps : `{ replayUrl: string | null }` — `null` (ou chaîne vide) efface.
 *
 * Réservé à la permission `live` (admin, arbitre, caster), comme la diffusion
 * en direct dont la rediff est la suite.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "live")) return fail("FORBIDDEN", 403);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await req.json().catch(() => ({}))) as { replayUrl?: unknown };
  const raw = body.replayUrl ?? null;
  if (raw !== null && typeof raw !== "string") return fail("INVALID_REPLAY_URL", 400);

  try {
    const replayUrl = await setMatchReplayUrl(matchId, raw);
    return ok({ replayUrl });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "MATCH_NOT_FOUND") return fail(message, 404);
    if (message === "INVALID_REPLAY_URL") return fail(message, 400);
    if (message === "MATCH_NOT_REPLAYABLE") return fail(message, 409);
    return fail("MATCH_REPLAY_UPDATE_FAILED", 500);
  }
}
