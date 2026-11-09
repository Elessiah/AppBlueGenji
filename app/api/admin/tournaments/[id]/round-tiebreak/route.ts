import { parseRoundKey, setRoundTiebreak } from "@/lib/server/tournaments/round-maps";
import { roundMapsStaffPut } from "@/lib/server/tournaments/round-maps-routes";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_ROUND: 400,
  INVALID_TIEBREAK_MAP: 400,
  TIEBREAK_NOT_ALLOWED: 400,
  TOURNAMENT_NOT_FOUND: 404,
};

/**
 * Map de départage d'un tour de play-offs à format de match défini
 * (`docs/features/ROUND_MAPS.md`). Corps : `{ phaseId, bracket, roundNumber,
 * map: string | null }` — `null` (ou vide) la retire ; un corps sans `map` est
 * refusé (`INVALID_TIEBREAK_MAP`). Jouée en N + 1 seulement si la série est à
 * égalité après les N maps régulières. Réservé à l'arbitrage (`tournaments`).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return roundMapsStaffPut(req, context, STATUSES, "ROUND_TIEBREAK_FAILED", async (tournamentId, body) => {
    const round = parseRoundKey(body);
    if (body.map === undefined) throw new Error("INVALID_TIEBREAK_MAP");
    return { map: await setRoundTiebreak(tournamentId, round, body.map) };
  });
}
