import { parseRoundKey, setRoundPointTarget } from "@/lib/server/tournaments/round-maps";
import { roundMapsStaffPut } from "@/lib/server/tournaments/round-maps-routes";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_ROUND: 400,
  INVALID_MAP_POINT_TARGET: 400,
  MAP_POINTS_DISABLED: 400,
  MAP_POINTS_LOCKED: 409,
  TOURNAMENT_NOT_FOUND: 404,
};

/**
 * Points par carte propres à un tour, en format Duel / Arcade
 * (`docs/features/DUEL_ARCADE.md`). Corps : `{ phaseId, bracket, roundNumber,
 * target: number | null }` — `null` rend au tour les points du tournoi. Refusé
 * dès qu'un match du tour porte un score (`MAP_POINTS_LOCKED`). Réservé à
 * l'arbitrage (`tournaments`).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return roundMapsStaffPut(req, context, STATUSES, "ROUND_POINTS_FAILED", async (tournamentId, body) => {
    const round = parseRoundKey(body);
    if (!("target" in body)) throw new Error("INVALID_MAP_POINT_TARGET");
    return { target: await setRoundPointTarget(tournamentId, round, body.target) };
  });
}
