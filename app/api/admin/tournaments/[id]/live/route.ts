import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setTournamentLiveUrl } from "@/lib/server/tournaments/live-streams";
import { can } from "@/lib/shared/permissions";

/**
 * Renseigne la chaîne officielle du tournoi. Corps : `{ liveUrl: string | null }`
 * (chaîne vide = effacement).
 *
 * Permission `tournaments` et non `live` : la chaîne principale engage
 * l'organisation, là où un caster ne pose que le lien de son propre match.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as { liveUrl?: unknown };
  if (body.liveUrl !== null && body.liveUrl !== undefined && typeof body.liveUrl !== "string") {
    return fail("INVALID_STREAM_URL", 400);
  }

  try {
    const liveUrl = await setTournamentLiveUrl(tournamentId, body.liveUrl ?? null);
    return ok({ liveUrl });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message === "INVALID_STREAM_URL") return fail(message, 400);
    return fail(message || "TOURNAMENT_LIVE_UPDATE_FAILED", 500);
  }
}
