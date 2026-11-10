import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, VOICE_CLEAR_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { clearOwnTeamVoiceChannel } from "@/lib/server/tournaments/match-voice";

/**
 * Vide le salon vocal de **sa propre** équipe (`docs/features/MATCH_VOICE.md`, décision D36) :
 * le bot en déconnecte tous les occupants, le salon reste ouvert. Corps : `{ teamId: number }`.
 *
 * Réservé au `OWNER`, `MANAGER` ou `CAPITAINE` de l'équipe visée, son équipe active
 * (`403 VOICE_CLEAR_NOT_TEAM_LEADER` pour un non-membre, un membre sans ces rôles, l'équipe
 * adverse, une entrée solo) ; l'arbitrage passe par `POST /api/admin/matches/[matchId]/voice/clear`.
 * Même débit que l'arbitrage (`VOICE_CLEAR_RULE`, par compte). Ni pm2 ni Discord ne nomment
 * l'auteur, et rien n'est gardé (D15) ; la réponse ne dit ni qui, ni combien.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const throttled = enforceRateLimit(VOICE_CLEAR_RULE, user.id);
  if (throttled) return throttled;

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES).catch(() => ({}))) as { teamId?: unknown } | null;
  const teamId = body?.teamId;
  if (typeof teamId !== "number" || !Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM_ID", 400);

  try {
    const result = await clearOwnTeamVoiceChannel(matchId, teamId, user.id);
    if (result === "notLeader") return fail("VOICE_CLEAR_NOT_TEAM_LEADER", 403);
    if (result === "notOpen") return fail("VOICE_CHANNEL_NOT_OPEN", 409);
    if (result === "unavailable") return fail("VOICE_CLEAR_UNAVAILABLE", 503);
    return ok({ cleared: true });
  } catch {
    return fail("VOICE_CLEAR_FAILED", 500);
  }
}
