import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { applyEndurancePenalty } from "@/lib/server/tournaments-service";
import { checkEndurancePenalty } from "@/lib/shared/endurance-penalty";
import { can } from "@/lib/shared/permissions";

/**
 * Inflige une pénalité de points d'endurance à un engagé (mode « BlueGenji
 * Survie », `docs/features/ENDURANCE_PENALTIES.md`).
 *
 * **Arbitrage uniquement** (`tournaments`) : c'est une sanction, pas un geste
 * d'engagé. Un représentant d'équipe peut déclarer *son* abandon, il ne se
 * pénalise pas lui-même — et surtout n'en pénalise pas une autre.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as {
    teamId?: unknown;
    points?: unknown;
    reason?: unknown;
  };

  const teamId = Number(body.teamId);
  if (!Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM", 400);

  // Le corps arrive du réseau : `points` peut être une chaîne, `reason` peut
  // manquer. La règle, elle, est celle du module partagé — le formulaire n'en
  // est que la première passe.
  const points = Number(body.points);
  const reason = typeof body.reason === "string" ? body.reason : "";
  const violation = checkEndurancePenalty(points, reason);
  if (violation !== null) return fail(violation, 400);

  try {
    await applyEndurancePenalty(tournamentId, teamId, points, reason, user.id);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "NOT_BG_SURVIE" ||
      message === "TOURNAMENT_NOT_RUNNING" ||
      message === "ENDURANCE_PLAYOFFS_STARTED" ||
      message === "TEAM_ALREADY_OUT" ||
      message === "INVALID_PENALTY"
    ) {
      return fail(message, 400);
    }
    if (message === "TEAM_NOT_IN_TOURNAMENT") return fail(message, 404);
    return fail(message || "PENALTY_FAILED", 500);
  }
}
