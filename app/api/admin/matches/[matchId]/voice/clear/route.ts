import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, VOICE_CLEAR_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { clearTeamVoiceChannel } from "@/lib/server/tournaments/match-voice";
import { announceStaffMatchAction } from "@/lib/server/tournaments/staff-action-logs";
import { can } from "@/lib/shared/permissions";

/**
 * Vide le salon vocal d'une équipe d'un match (`docs/features/MATCH_VOICE.md`,
 * décision D13) : le bot en déconnecte tous les occupants, le salon reste ouvert.
 * Corps : `{ teamId: number }`.
 *
 * Permission `tournaments` — celle de l'arbitrage (l'arbitre du match, et le staff
 * des tournois) —, jamais pour qui joue ce match (`403 VOICE_CLEAR_IS_PLAYER`) ;
 * seulement tant que la page montre le salon (tournoi en cours, option allumée, match
 * jouable). Débit plafonné par compte (`VOICE_CLEAR_RULE`). Un membre du staff qui n'est
 * pas l'arbitre désigné du match (colonne du match, quel que soit son état) est nommé dans
 * pm2 (`auditStaffAction`) **avant** l'appel au bot, réussi ou non ; l'arbitre désigné
 * jamais. Un vidage réussi est annoncé comme geste du staff (`VOICE_CLEARED`, anonyme sur
 * Discord). La réponse ne dit ni qui a été déconnecté, ni combien ; rien n'est gardé.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const throttled = enforceRateLimit(VOICE_CLEAR_RULE, user.id);
  if (throttled) return throttled;

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES).catch(() => ({}))) as { teamId?: unknown } | null;
  const teamId = body?.teamId;
  if (typeof teamId !== "number" || !Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM_ID", 400);

  try {
    const result = await clearTeamVoiceChannel(matchId, teamId, user.id, (designated) => {
      if (!designated) {
        auditStaffAction(`Vidage du salon vocal d'une équipe demandé — match #${matchId}`, { id: user.id, pseudo: user.pseudo });
      }
    });
    if (result === "notOpen") return fail("VOICE_CHANNEL_NOT_OPEN", 409);
    if (result === "player") return fail("VOICE_CLEAR_IS_PLAYER", 403);
    if (result === "unavailable") return fail("VOICE_CLEAR_UNAVAILABLE", 503);
    announceStaffMatchAction(matchId, "VOICE_CLEARED");
    return ok({ cleared: true });
  } catch {
    return fail("VOICE_CLEAR_FAILED", 500);
  }
}
