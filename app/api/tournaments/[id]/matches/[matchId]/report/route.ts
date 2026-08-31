import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { reportMatchScore } from "@/lib/server/tournaments-service";

export async function POST(req: Request, context: { params: Promise<{ id: string; matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id, matchId: rawMatchId } = await context.params;
  const tournamentId = Number(id);
  const matchId = Number(rawMatchId);

  // Deux identifiants, deux codes : `INVALID_ID` laissait le client deviner
  // lequel des deux était en cause, et divisait le vocabulaire des routes
  // sœurs, qui nomment déjà `INVALID_TOURNAMENT_ID`.
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return fail("INVALID_MATCH_ID", 400);
  }

  try {
    const body = (await req.json()) as { myScore?: number; opponentScore?: number };

    await reportMatchScore(
      tournamentId,
      matchId,
      user.id,
      Number(body.myScore),
      Number(body.opponentScore),
    );

    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "DRAW_NOT_ALLOWED"
      || message === "INVALID_SCORE"
      || message === "INVALID_SCORE_RANGE"
      || message === "NO_ACTIVE_TEAM"
      || message === "TOURNAMENT_NOT_RUNNING"
      || message === "MATCH_NOT_READY"
      || message === "NOT_IN_MATCH"
      || message === "MATCH_ALREADY_COMPLETED"
      || message === "SCORE_EXCEEDS_MATCH_FORMAT"
      || message === "SCORE_BELOW_MATCH_FORMAT"
    ) {
      return fail(message, 400);
    }

    if (message === "TOURNAMENT_NOT_FOUND" || message === "MATCH_NOT_FOUND") {
      return fail(message, 404);
    }

    return fail(message || "SCORE_REPORT_FAILED", 500);
  }
}
