import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { adminResolveMatch } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";
import { parseAdminScoreBody, parseAdminMapEntry } from "@/lib/shared/admin-score-body";
import { MAP_LIST_ERROR_CODES, type MatchMapInput } from "@/lib/shared/match-maps";

export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
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

  // Double forfait : les deux engagées déclarent forfait, la rencontre se clôt
  // sans vainqueur (`lib/shared/double-forfeit.ts`). Un booléen strict, et
  // exclusif de tout le reste : un corps qui porterait aussi un score ou une
  // équipe dirait deux choses, et on ne choisit pas à la place de l'arbitre.
  // `null` vaut absence, comme pour les trois autres champs.
  if (body.doubleForfeit !== undefined && body.doubleForfeit !== null && body.doubleForfeit !== false) {
    if (body.doubleForfeit !== true) return fail("INVALID_REQUEST", 400);
    const mixed = [body.team1Score, body.team2Score, body.forfeitTeamId, body.maps].some(
      (value) => value !== undefined && value !== null,
    );
    if (mixed) return fail("DOUBLE_FORFEIT_EXCLUSIVE", 400);
    return resolve(matchId_, undefined, undefined, undefined, true, user.id);
  }

  // L'égalité n'est plus refusée d'office : c'est le **format de la manche**
  // qui tranche (`checkMatchScores`), et lui seul sait qu'une qualification
  // de « BlueGenji Survie » peut se clore sur un 2-2. Le refus arrive donc du
  // service, en `DRAW_NOT_ALLOWED` comme avant, mais avec la bonne règle.
  // Détail map par map facultatif (`docs/features/MAP_SCORES.md`) : présent,
  // il fait foi et le score se dérive des maps.
  const mapParse = parseAdminMapEntry(body.maps);
  if (!mapParse.ok) return fail(mapParse.error, 400);
  const parsed = parseAdminScoreBody(mapParse.maps ? { ...body, ...mapParse.placeholderScores } : body);
  if (!parsed.ok) return fail(parsed.error, 400);
  const { team1Score, team2Score, forfeitTeamId } = parsed.value;

  return resolve(matchId_, team1Score, team2Score, forfeitTeamId, false, user.id, mapParse.maps);
}

async function resolve(
  matchId: number,
  team1Score: number | undefined,
  team2Score: number | undefined,
  forfeitTeamId: number | undefined,
  doubleForfeit: boolean,
  userId: number,
  maps?: MatchMapInput[] | null,
) {
  try {
    // L'arbitrage tranche toujours avec un détail de maps — vide sur un
    // forfait ou un score posé à la main : celui d'avant ne décrirait plus le
    // résultat retenu.
    await adminResolveMatch(matchId, team1Score, team2Score, forfeitTeamId, doubleForfeit, {
      maps: maps ?? [],
      userId,
    });
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    const status = MAP_LIST_ERROR_CODES.has(msg) ? 400 : RESOLVE_ERROR_STATUS.get(msg);
    return fail(msg || "ADMIN_RESOLVE_FAILED", status ?? 500);
  }
}

const RESOLVE_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ["MATCH_NOT_FOUND", 404],
  ["MATCH_ALREADY_COMPLETED", 409],
  ["MATCH_NOT_READY", 409],
  ["MATCH_NOT_IN_LAUNCH", 409],
  ["CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES", 409],
  ["SCORE_EXCEEDS_MATCH_FORMAT", 400],
  ["SCORE_BELOW_MATCH_FORMAT", 400],
  ["DRAW_NOT_ALLOWED", 400],
  // Forfait déclaré pour une équipe qui ne joue pas ce match : corps
  // invalide, pas une panne — le contrôle n'est possible qu'une fois le
  // match chargé, donc à l'intérieur du service.
  ["INVALID_FORFEIT_TEAM_ID", 400],
  ["INVALID_REQUEST", 400],
]);
