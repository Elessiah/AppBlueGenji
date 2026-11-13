import { auditStaffAction } from "@/lib/server/staff-audit";
import { parseRoundKey, setRoundPointTarget } from "@/lib/server/tournaments/round-maps";
import { roundMapsStaffPut } from "@/lib/server/tournaments/round-maps-routes";
import type { RoundKey } from "@/lib/shared/round-maps";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_ROUND: 400,
  INVALID_MAP_POINT_TARGET: 400,
  MAP_POINTS_DISABLED: 400,
  MAP_POINTS_LOCKED: 409,
  MAP_POINTS_FINISHED: 409,
  TOURNAMENT_NOT_FOUND: 404,
};

/** Ligne pm2 d'un changement de points : tour, avant, après (`null` = suit le tournoi). */
function roundPointsAuditLine(
  tournamentId: number,
  round: RoundKey,
  before: number | null,
  after: number | null,
): string {
  const shown = (value: number | null) => (value === null ? "points du tournoi" : String(value));
  return `🎯 Points par carte du tournoi #${tournamentId}, phase ${round.phaseId} ${round.bracket} tour ${round.roundNumber} : ${shown(before)} → ${shown(after)}`;
}

/**
 * Points par carte propres à un tour, en format Duel / Arcade
 * (`docs/features/DUEL_ARCADE.md`). Corps : `{ phaseId, bracket, roundNumber,
 * target: number | null }` — `null` rend au tour les points du tournoi. Refusé
 * dès qu'un match jouable du tour porte un score ou est lancé
 * (`MAP_POINTS_LOCKED`), et la pose sur un tournoi terminé
 * (`MAP_POINTS_FINISHED`). Réservé à l'arbitrage (`tournaments`). Le journal
 * Discord du staff reçoit l'annonce anonyme regroupée (`round-maps-notice`) ;
 * l'auteur n'est nommé que dans pm2 (`auditStaffAction`).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return roundMapsStaffPut(req, context, STATUSES, "ROUND_POINTS_FAILED", async (tournamentId, body, user) => {
    const round = parseRoundKey(body);
    if (!("target" in body)) throw new Error("INVALID_MAP_POINT_TARGET");
    const change = await setRoundPointTarget(tournamentId, round, body.target);
    if (change.changed) {
      auditStaffAction(roundPointsAuditLine(tournamentId, round, change.before, change.target), {
        id: user.id,
        pseudo: user.pseudo,
      });
    }
    return { target: change.target };
  });
}
