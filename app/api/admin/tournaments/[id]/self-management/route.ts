import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { setRoundSelfManaged } from "@/lib/server/tournaments/match-launch";
import { isPositiveId, launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  TOURNAMENT_NOT_FOUND: 404,
};

const BRACKETS = new Set(["UPPER", "LOWER", "GRAND", "THIRD_PLACE"]);

/**
 * Autogestion de toute une manche, d'un geste (`docs/features/MATCH_REFEREE.md`).
 * Corps : `{ phaseId, roundNumber, bracket?: string | null, enabled }` — sans
 * `bracket`, tous les tableaux de la manche. Seuls les matchs encore à jouer
 * changent (exemptions exclues). Réservé à l'arbitrage.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const body = (await readJsonBody(req).catch(() => ({}))) as {
    phaseId?: unknown;
    roundNumber?: unknown;
    bracket?: unknown;
    enabled?: unknown;
  };
  const phaseId = body.phaseId;
  const roundNumber = body.roundNumber;
  const bracket = body.bracket ?? null;
  const validPhase = typeof phaseId === "number" && Number.isInteger(phaseId) && phaseId >= 0;
  if (!validPhase || !isPositiveId(roundNumber)) return fail("INVALID_ROUND", 400);
  if (bracket !== null && (typeof bracket !== "string" || !BRACKETS.has(bracket))) {
    return fail("INVALID_ROUND", 400);
  }
  if (typeof body.enabled !== "boolean") return fail("INVALID_SELF_MANAGEMENT", 400);

  try {
    const changed = await setRoundSelfManaged(tournamentId, { phaseId, roundNumber, bracket }, body.enabled);
    return ok({ changed });
  } catch (error) {
    return launchFailure(error, STATUSES, "ROUND_SELF_MANAGEMENT_FAILED");
  }
}
