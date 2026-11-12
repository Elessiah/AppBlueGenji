import { MAP_PICK_STAFF_WRITE_RULE, MAP_PICK_WRITE_RULE, reserveRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { pickMatchMap } from "@/lib/server/tournaments/round-maps";
import { can } from "@/lib/shared/permissions";

const STATUSES: Readonly<Record<string, number>> = {
  INVALID_MAP_PICK: 400,
  NOT_MAP_PICKER: 403,
  MATCH_NOT_FOUND: 404,
  TOURNAMENT_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
};

/**
 * Choisit une carte du match dans le pool de sa manche
 * (`docs/features/ROUND_MAPS.md`). Corps : `{ slot: number, map: string | null }`.
 * L'arbitrage (`tournaments`) le peut toujours ; sur un match en autogestion,
 * les joueurs d'une des deux équipes qui déclarent son « Prêt » aussi.
 * Plafonné par compte (`MAP_PICK_WRITE_RULE`, plus haut pour l'arbitrage :
 * `MAP_PICK_STAFF_WRITE_RULE` ; 429 `TOO_MANY_REQUESTS`), un choix refusé
 * rendant sa place. Un
 * match absent rend 404 et un match d'autrui 403 : l'identifiant d'un match
 * n'est pas un secret (l'instantané public de son tournoi le porte).
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const staff = can(user, "tournaments");
  const reservation = reserveRateLimit(staff ? MAP_PICK_STAFF_WRITE_RULE : MAP_PICK_WRITE_RULE, user.id);
  if (reservation.refused) return reservation.refused;

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) {
    reservation.refund();
    return read.refusal;
  }
  const body = read.body as { slot?: unknown; map?: unknown };
  try {
    await pickMatchMap(matchId, { userId: user.id, staff }, body.slot, body.map ?? null);
    return ok({});
  } catch (error) {
    // Refus métier (carte refusée, match d'autrui ou clos) : rien n'a été écrit.
    if (error instanceof Error && Object.hasOwn(STATUSES, error.message)) reservation.refund();
    return launchFailure(error, STATUSES, "MAP_PICK_FAILED");
  }
}
