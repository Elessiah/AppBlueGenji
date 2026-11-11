import { parseRoundKey, parseRoundKeys, setRoundsMaps } from "@/lib/server/tournaments/round-maps";
import { roundMapsStaffPut } from "@/lib/server/tournaments/round-maps-routes";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_ROUND: 400,
  INVALID_ROUND_MAPS: 400,
  TOURNAMENT_NOT_FOUND: 404,
};

/**
 * Cartes d'une manche (`docs/features/ROUND_MAPS.md`). Corps :
 * `{ phaseId, bracket, roundNumber, slots: string[][] }` — chaque créneau, ses
 * cartes candidates (une = imposée, plusieurs = pool) ; `slots: []` retire le
 * réglage. `rounds: [{ phaseId, bracket, roundNumber }, …]` à la place de la
 * manche seule pose les mêmes cartes sur chacun de ces tours (« Appliquer à
 * tous les tours », copie vers un tour) ; la réponse dit alors dans `skipped`
 * combien de ces tours le tournoi ne porte plus. Modifiable à tout moment, y compris
 * sur un tour pas encore généré. Réservé à l'arbitrage (`tournaments` :
 * tout arbitre la porte, `refereeBlockReason`).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return roundMapsStaffPut(req, context, STATUSES, "ROUND_MAPS_FAILED", async (tournamentId, body) => {
    const rounds = body.rounds === undefined ? [parseRoundKey(body)] : parseRoundKeys(body.rounds);
    return setRoundsMaps(tournamentId, rounds, body.slots);
  });
}
