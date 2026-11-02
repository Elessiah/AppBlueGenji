import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { parseRoundKey, setRoundTiebreak } from "@/lib/server/tournaments/round-maps";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_ROUND: 400,
  INVALID_TIEBREAK_MAP: 400,
  TIEBREAK_NOT_ALLOWED: 400,
  TOURNAMENT_NOT_FOUND: 404,
};

/**
 * Map de départage d'un tour de play-offs en vrai best of 3
 * (`docs/features/ROUND_MAPS.md`). Corps : `{ phaseId, bracket, roundNumber,
 * map: string | null }` — `null` (ou vide) la retire. Jouée seulement si la
 * série est à égalité après les trois maps régulières. Réservé à l'arbitrage
 * (`tournaments`).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as {
    phaseId?: unknown;
    bracket?: unknown;
    roundNumber?: unknown;
    map?: unknown;
  };
  try {
    const map = await setRoundTiebreak(tournamentId, parseRoundKey(body), body.map);
    return ok({ map });
  } catch (error) {
    return launchFailure(error, STATUSES, "ROUND_TIEBREAK_FAILED");
  }
}
