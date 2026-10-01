import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { enforceRateLimit, ISSUE_REPORT_DAILY_RULE, ISSUE_REPORT_RULE } from "@/lib/server/api-guard";
import { reportTournamentIssue } from "@/lib/server/tournaments/issue-reports";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * Signale un problème au staff depuis la page d'un tournoi.
 *
 * Corps : `{ message: string, matchId?: number | null }` — `matchId` absent ou
 * `null` désigne le tournoi entier.
 *
 * Réservé aux **engagés** du tournoi, et une manche aux seuls engagés qui la
 * jouent : le service revérifie les deux, le bouton de l'interface ne suffit
 * pas à en faire un droit. Plafonné, parce que
 * la route fait vibrer le téléphone des arbitres à chaque appel.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const limited = enforceRateLimit(ISSUE_REPORT_RULE, user.id) ?? enforceRateLimit(ISSUE_REPORT_DAILY_RULE, user.id);
  if (limited) return limited;

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  // Tournoi non publié : même 404 qu'un identifiant inexistant, avant tout
  // autre refus (`write-visibility.ts`).
  if (!(await canActOnTournament(tournamentId, user))) return fail("TOURNAMENT_NOT_FOUND", 404);

  const body = (await readJsonBody(req).catch(() => ({}))) as {
    message?: unknown;
    matchId?: unknown;
  };

  const matchId = parseMatchId(body.matchId);
  if (matchId === false) return fail("INVALID_MATCH_ID", 400);

  try {
    const result = await reportTournamentIssue(tournamentId, user.id, body.message, matchId);
    return ok(result);
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "ISSUE_REPORT_FAILED", ISSUE_REPORT_ERROR_STATUS.get(message) ?? 500);
  }
}

/** Manche visée : `null` pour le tournoi entier, `false` si l'identifiant est invalide. */
function parseMatchId(raw: unknown): number | null | false {
  if (raw === undefined || raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : false;
}

const ISSUE_REPORT_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ["INVALID_ISSUE_MESSAGE", 400],
  ["NOT_REGISTERED", 403],
  ["NOT_MATCH_PARTICIPANT", 403],
  ["TOURNAMENT_NOT_FOUND", 404],
  ["MATCH_NOT_FOUND", 404],
  // Le bot est le seul chemin vers les arbitres : injoignable, le signalement
  // n'a pas eu lieu et l'interface doit le dire plutôt que rassurer à tort.
  ["BOT_INTERNAL_UNREACHABLE", 503],
]);
