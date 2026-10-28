import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { parseRoundKey, setRoundMaps } from "@/lib/server/tournaments/round-maps";
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
 * réglage. Modifiable à tout moment. Réservé à l'arbitrage (`tournaments` :
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
    slots?: unknown;
  };
  try {
    const slots = await setRoundMaps(tournamentId, parseRoundKey(body), body.slots);
    return ok({ slots });
  } catch (error) {
    return launchFailure(error, STATUSES, "ROUND_MAPS_FAILED");
  }
}
