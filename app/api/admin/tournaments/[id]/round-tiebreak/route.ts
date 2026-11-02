import { parseRoundKey, setRoundTiebreak } from "@/lib/server/tournaments/round-maps";
import { roundMapsStaffPut } from "@/lib/server/tournaments/round-maps-routes";

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
  return roundMapsStaffPut(req, context, STATUSES, "ROUND_TIEBREAK_FAILED", async (tournamentId, body) => ({
    map: await setRoundTiebreak(tournamentId, parseRoundKey(body), body.map),
  }));
}
