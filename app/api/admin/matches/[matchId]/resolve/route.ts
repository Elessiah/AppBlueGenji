import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { adminResolveMatch } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";

export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { matchId } = await context.params;
  const matchId_ = Number(matchId);
  if (!Number.isInteger(matchId_) || matchId_ <= 0) return fail("INVALID_MATCH_ID", 400);

  const body = (await req.json()) as {
    team1Score?: unknown;
    team2Score?: unknown;
    forfeitTeamId?: unknown;
    doubleForfeit?: unknown;
  };

  // Double forfait : les deux engagées déclarent forfait, la rencontre se clôt
  // sans vainqueur (`lib/shared/double-forfeit.ts`). Un booléen strict, et
  // exclusif de tout le reste : un corps qui porterait aussi un score ou une
  // équipe dirait deux choses, et on ne choisit pas à la place de l'arbitre.
  // `null` vaut absence, comme pour les trois autres champs.
  if (body.doubleForfeit !== undefined && body.doubleForfeit !== null && body.doubleForfeit !== false) {
    if (body.doubleForfeit !== true) return fail("INVALID_REQUEST", 400);
    const mixed = [body.team1Score, body.team2Score, body.forfeitTeamId].some(
      (value) => value !== undefined && value !== null,
    );
    if (mixed) return fail("DOUBLE_FORFEIT_EXCLUSIVE", 400);
    return resolve(matchId_, undefined, undefined, undefined, true);
  }

  const forfeitTeamId = body.forfeitTeamId !== undefined && body.forfeitTeamId !== null ? Number(body.forfeitTeamId) : undefined;
  const team1Score = body.team1Score !== undefined && body.team1Score !== null ? Number(body.team1Score) : undefined;
  const team2Score = body.team2Score !== undefined && body.team2Score !== null ? Number(body.team2Score) : undefined;

  // Validate forfeit mode
  if (forfeitTeamId !== undefined) {
    if (!Number.isInteger(forfeitTeamId) || forfeitTeamId <= 0) {
      return fail("INVALID_FORFEIT_TEAM_ID", 400);
    }
  }
  // Validate score mode
  else if (team1Score !== undefined && team2Score !== undefined) {
    if (
      !Number.isFinite(team1Score) ||
      !Number.isFinite(team2Score) ||
      !Number.isInteger(team1Score) ||
      !Number.isInteger(team2Score) ||
      team1Score < 0 ||
      team2Score < 0 ||
      team1Score > 99 ||
      team2Score > 99
    ) {
      return fail("INVALID_SCORES", 400);
    }

    // L'égalité n'est plus refusée d'office : c'est le **format de la manche**
    // qui tranche (`checkMatchScores`), et lui seul sait qu'une qualification
    // de « BlueGenji Survie » peut se clore sur un 2-2. Le refus arrive donc du
    // service, en `DRAW_NOT_ALLOWED` comme avant, mais avec la bonne règle.
  } else {
    return fail("MISSING_SCORES_OR_FORFEIT", 400);
  }

  return resolve(matchId_, team1Score, team2Score, forfeitTeamId, false);
}

async function resolve(
  matchId: number,
  team1Score: number | undefined,
  team2Score: number | undefined,
  forfeitTeamId: number | undefined,
  doubleForfeit: boolean,
) {
  try {
    await adminResolveMatch(matchId, team1Score, team2Score, forfeitTeamId, doubleForfeit);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    const status =
      msg === "MATCH_NOT_FOUND" ? 404
      : msg === "MATCH_ALREADY_COMPLETED" || msg === "MATCH_NOT_READY" || msg === "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES" ? 409
      : msg === "SCORE_EXCEEDS_MATCH_FORMAT" ||
        msg === "SCORE_BELOW_MATCH_FORMAT" ||
        msg === "DRAW_NOT_ALLOWED" ? 400
      // Forfait déclaré pour une équipe qui ne joue pas ce match : corps
      // invalide, pas une panne — le contrôle n'est possible qu'une fois le
      // match chargé, donc à l'intérieur du service.
      : msg === "INVALID_FORFEIT_TEAM_ID" || msg === "INVALID_REQUEST" ? 400
      : 500;
    return fail(msg || "ADMIN_RESOLVE_FAILED", status);
  }
}
