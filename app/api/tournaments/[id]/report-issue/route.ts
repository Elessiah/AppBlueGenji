import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { enforceRateLimit, ISSUE_REPORT_RULE } from "@/lib/server/api-guard";
import { reportTournamentIssue } from "@/lib/server/tournaments/issue-reports";

/**
 * Signale un problème au staff depuis la page d'un tournoi.
 *
 * Corps : `{ message: string, matchId?: number | null }` — `matchId` absent ou
 * `null` désigne le tournoi entier.
 *
 * Réservé aux **engagés** du tournoi : le service revérifie l'inscription, le
 * bouton de l'interface ne suffit pas à en faire un droit. Plafonné, parce que
 * la route fait vibrer le téléphone des arbitres à chaque appel.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const limited = enforceRateLimit(ISSUE_REPORT_RULE, user.id);
  if (limited) return limited;

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    matchId?: unknown;
  };

  let matchId: number | null = null;
  if (body.matchId !== undefined && body.matchId !== null) {
    const parsed = Number(body.matchId);
    if (!Number.isInteger(parsed) || parsed <= 0) return fail("INVALID_MATCH_ID", 400);
    matchId = parsed;
  }

  try {
    const result = await reportTournamentIssue(tournamentId, user.id, body.message, matchId);
    return ok(result);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "INVALID_ISSUE_MESSAGE") return fail(message, 400);
    if (message === "NOT_REGISTERED") return fail(message, 403);
    if (message === "TOURNAMENT_NOT_FOUND" || message === "MATCH_NOT_FOUND") {
      return fail(message, 404);
    }
    // Le bot est le seul chemin vers les arbitres : injoignable, le signalement
    // n'a pas eu lieu et l'interface doit le dire plutôt que rassurer à tort.
    if (message === "BOT_INTERNAL_UNREACHABLE") return fail(message, 503);
    return fail(message || "ISSUE_REPORT_FAILED", 500);
  }
}
