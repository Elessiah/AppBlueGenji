import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { adminSaveMatchScores } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";
import { parseAdminScoreBody, parseAdminMapEntry } from "@/lib/shared/admin-score-body";
import { MAP_LIST_ERROR_CODES } from "@/lib/shared/match-maps";

export async function PATCH(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { matchId } = await context.params;
  const matchId_ = Number(matchId);
  if (!Number.isInteger(matchId_) || matchId_ <= 0) return fail("INVALID_MATCH_ID", 400);

  const body = (await readJsonBody(req)) as {
    team1Score?: unknown;
    team2Score?: unknown;
    forfeitTeamId?: unknown;
    doubleForfeit?: unknown;
    maps?: unknown;
  };

  // Un double forfait **tranche** la rencontre : il n'a rien d'un avancement à
  // noter. Il passe par `/resolve`, seule route qui propage dans le plateau —
  // l'accepter ici laisserait une rencontre « en cours » sans score ni équipe.
  if (body.doubleForfeit === true) return fail("DOUBLE_FORFEIT_RESOLVE_ONLY", 400);

  // Détail map par map facultatif (`docs/features/MAP_SCORES.md`) : présent,
  // il fait foi et le score se dérive des maps.
  const mapParse = parseAdminMapEntry(body.maps);
  if (!mapParse.ok) return fail(mapParse.error, 400);
  const hasMaps = (mapParse.maps?.length ?? 0) > 0;
  const parsed = parseAdminScoreBody(hasMaps ? { ...body, ...mapParse.placeholderScores } : body);
  if (!parsed.ok) return fail(parsed.error, 400);
  // L'égalité est autorisée sur cette route : on enregistre les scores sans déclarer de vainqueur.
  const { team1Score, team2Score, forfeitTeamId } = parsed.value;
  const mapEntry = mapParse.maps === null ? undefined : { maps: mapParse.maps, userId: user.id };

  try {
    await adminSaveMatchScores(matchId_, team1Score, team2Score, forfeitTeamId, mapEntry);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    const status = MAP_LIST_ERROR_CODES.has(msg) ? 400 : SAVE_SCORES_ERROR_STATUS.get(msg);
    return fail(msg || "ADMIN_SAVE_SCORES_FAILED", status ?? 500);
  }
}

const SAVE_SCORES_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ["MATCH_NOT_FOUND", 404],
  ["MATCH_ALREADY_COMPLETED", 409],
  ["MATCH_NOT_READY", 409],
  ["MATCH_NOT_IN_LAUNCH", 409],
  ["CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES", 409],
  ["SCORE_EXCEEDS_MATCH_FORMAT", 400],
  ["SCORE_BELOW_MATCH_FORMAT", 400],
  // Forfait déclaré pour une équipe qui ne joue pas ce match : corps
  // invalide, pas une panne — le contrôle n'est possible qu'une fois le
  // match chargé, donc à l'intérieur du service.
  ["INVALID_FORFEIT_TEAM_ID", 400],
]);
