import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { reportMatchScore } from "@/lib/server/tournaments-service";
import { readJsonBody } from "@/lib/server/request-body";
import { MAP_LIST_ERROR_CODES, parseMapListBody } from "@/lib/shared/match-maps";

export async function POST(req: Request, context: { params: Promise<{ id: string; matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id, matchId: rawMatchId } = await context.params;
  const tournamentId = Number(id);
  const matchId = Number(rawMatchId);

  // Deux identifiants, deux codes : `INVALID_ID` laissait le client deviner
  // lequel des deux était en cause, et divisait le vocabulaire des routes
  // sœurs, qui nomment déjà `INVALID_TOURNAMENT_ID`.
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return fail("INVALID_MATCH_ID", 400);
  }

  // Tournoi non publié : même 404 qu'un identifiant inexistant, avant tout
  // autre refus (`write-visibility.ts`).
  if (!(await canActOnTournament(tournamentId, user))) return fail("TOURNAMENT_NOT_FOUND", 404);

  try {
    const body = (await readJsonBody(req)) as { maps?: unknown; confirm?: unknown };

    // Un score se déclare **map par map** (`docs/features/MAP_SCORES.md`) :
    // l'ancien corps `myScore` / `opponentScore` n'a plus cours, et se refuse
    // comme une liste vide.
    if (body.maps === undefined || body.maps === null) return fail("MAP_LIST_EMPTY", 400);
    const maps = parseMapListBody(body.maps);
    if (maps === null) return fail("INVALID_MAPS", 400);

    const confirm = parseConfirm(body.confirm);
    if (confirm === false) return fail("INVALID_REQUEST", 400);

    await reportMatchScore(tournamentId, matchId, user.id, maps, confirm);

    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    const status = MAP_LIST_ERROR_CODES.has(message) ? 400 : REPORT_ERROR_STATUS.get(message);
    return fail(message || "SCORE_REPORT_FAILED", status ?? 500);
  }
}

/**
 * « Confirmer » la proposition adverse telle quelle : l'instant de dépôt lu
 * dans la modale, que le serveur rapproche du dépôt en base
 * (`docs/features/MAP_SCORES.md`). `undefined` = simple envoi, `false` = corps
 * mal formé.
 */
function parseConfirm(raw: unknown): { reportedAt: string } | undefined | false {
  if (raw === undefined || raw === null) return undefined;
  const reportedAt = (raw as { reportedAt?: unknown }).reportedAt;
  return typeof reportedAt === "string" && reportedAt.length <= 40 ? { reportedAt } : false;
}

const REPORT_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ["DRAW_NOT_ALLOWED", 400],
  ["INVALID_SCORE", 400],
  ["INVALID_SCORE_RANGE", 400],
  ["NO_ACTIVE_TEAM", 400],
  ["TOURNAMENT_NOT_RUNNING", 400],
  ["MATCH_NOT_READY", 400],
  ["NOT_IN_MATCH", 400],
  ["MATCH_ALREADY_COMPLETED", 400],
  ["SCORE_EXCEEDS_MATCH_FORMAT", 400],
  ["SCORE_BELOW_MATCH_FORMAT", 400],
  // Membre sportif du roster : reporter un score engage l'équipe entière, et
  // revient à ceux qui mènent le match (capitaine, manager, propriétaire).
  ["NOT_TEAM_MATCH_LEADER", 403],
  // Le match existe et le score est bien formé : c'est son état qui refuse,
  // le temps que les parties se déclarent prêtes (`lib/shared/match-launch.ts`).
  ["MATCH_NOT_LAUNCHED", 409],
  // La proposition confirmée a changé ou n'existe plus : la modale se recharge.
  ["PROPOSAL_STALE", 409],
  ["TOURNAMENT_NOT_FOUND", 404],
  ["MATCH_NOT_FOUND", 404],
]);
