import { enforceRateLimit, MATCH_VOICE_READ_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { readMatchVoice } from "@/lib/server/tournaments/match-voice";
import { can } from "@/lib/shared/permissions";

/**
 * Salons vocaux d'équipe d'un match (`docs/features/MATCH_VOICE.md`) : l'état
 * de chaque salon et celui du verrou du lancement, jamais le nombre de personnes
 * — la porte REST de `TournamentMatch.voice`, que la page du match relit flux
 * coupé seulement. Connecté seulement.
 *
 * La lecture ne sollicite jamais le bot : elle relance le balayage (étranglé),
 * qui compte et publie un changement par le flux.
 */
export async function GET(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const throttled = enforceRateLimit(MATCH_VOICE_READ_RULE, user.id);
  if (throttled) return throttled;

  try {
    const voice = await readMatchVoice(matchId, can(user, "tournaments"));
    if (voice === undefined) return fail("MATCH_NOT_FOUND", 404);
    return ok({ voice });
  } catch {
    return fail("MATCH_VOICE_READ_FAILED", 500);
  }
}
