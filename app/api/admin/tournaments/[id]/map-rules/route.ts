import { parseMapRulesInput, setTournamentMapRules } from "@/lib/server/tournaments/round-maps";
import { roundMapsStaffPut } from "@/lib/server/tournaments/round-maps-routes";

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
  return roundMapsStaffPut(req, context, STATUSES, "MAP_RULES_FAILED", async (tournamentId, body) => {
    const rules = parseMapRulesInput(body);
    await setTournamentMapRules(tournamentId, rules);
    return { rules };
  });
}
