import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { parseMapRulesInput, setTournamentMapRules } from "@/lib/server/tournaments/round-maps";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_MAP_RULES: 400,
  TOURNAMENT_NOT_FOUND: 404,
};

/**
 * Règles de ban et de choix des cartes du tournoi (`docs/features/ROUND_MAPS.md`).
 * Corps : `{ firstBan: "NON_HOST" | "HOST", nextBan: "LOSER" | "WINNER",
 * nextPick: "LOSER" | "FREE" }`. Modifiable à tout moment. Réservé à l'arbitrage.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as {
    firstBan?: unknown;
    nextBan?: unknown;
    nextPick?: unknown;
  };
  try {
    const rules = parseMapRulesInput(body);
    await setTournamentMapRules(tournamentId, rules);
    return ok({ rules });
  } catch (error) {
    return launchFailure(error, STATUSES, "MAP_RULES_FAILED");
  }
}
