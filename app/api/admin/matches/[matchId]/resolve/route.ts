import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { adminResolveMatch } from "@/lib/server/tournaments-service";

export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  const { matchId } = await context.params;
  const matchId_ = Number(matchId);
  if (!Number.isInteger(matchId_) || matchId_ <= 0) return fail("INVALID_MATCH_ID", 400);

  const body = (await req.json()) as { team1Score?: unknown; team2Score?: unknown; forfeitTeamId?: unknown };

  const forfeitTeamId = body.forfeitTeamId ? Number(body.forfeitTeamId) : undefined;
  const team1Score = body.team1Score ? Number(body.team1Score) : undefined;
  const team2Score = body.team2Score ? Number(body.team2Score) : undefined;

  // Validate forfeit mode
  if (forfeitTeamId !== undefined) {
    if (!Number.isInteger(forfeitTeamId) || forfeitTeamId <= 0) {
      return fail("INVALID_FORFEIT_TEAM_ID", 400);
    }
  }
  // Validate score mode
  else if (team1Score !== undefined && team2Score !== undefined) {
    if (
      !Number.isFinite(team1Score) ||
      !Number.isFinite(team2Score) ||
      !Number.isInteger(team1Score) ||
      !Number.isInteger(team2Score) ||
      team1Score < 0 ||
      team2Score < 0 ||
      team1Score > 99 ||
      team2Score > 99
    ) {
      return fail("INVALID_SCORES", 400);
    }

    if (team1Score === team2Score) return fail("DRAW_NOT_ALLOWED", 400);
  } else {
    return fail("MISSING_SCORES_OR_FORFEIT", 400);
  }

  try {
    await adminResolveMatch(matchId_, team1Score, team2Score, forfeitTeamId);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    const status =
      msg === "MATCH_NOT_FOUND" ? 404
      : msg === "MATCH_ALREADY_COMPLETED" || msg === "MATCH_NOT_READY" || msg === "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES" ? 409
      : 500;
    return fail(msg || "ADMIN_RESOLVE_FAILED", status);
  }
}
