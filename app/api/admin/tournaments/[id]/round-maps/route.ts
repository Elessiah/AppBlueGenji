import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { parseRoundKey, parseRoundKeys, setRoundsMaps } from "@/lib/server/tournaments/round-maps";
import { can } from "@/lib/shared/permissions";

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
 * tous les tours », copie vers un tour). Modifiable à tout moment, y compris
 * sur un tour pas encore généré. Réservé à l'arbitrage (`tournaments` :
 * tout arbitre la porte, `refereeBlockReason`).
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
    rounds?: unknown;
    slots?: unknown;
  };
  try {
    const rounds = body.rounds === undefined ? [parseRoundKey(body)] : parseRoundKeys(body.rounds);
    const slots = await setRoundsMaps(tournamentId, rounds, body.slots);
    return ok({ slots });
  } catch (error) {
    return launchFailure(error, STATUSES, "ROUND_MAPS_FAILED");
  }
}
