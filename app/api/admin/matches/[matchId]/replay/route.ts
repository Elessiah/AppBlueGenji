import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchReplayUrl } from "@/lib/server/tournaments/match-replay";
import { can } from "@/lib/shared/permissions";
import { readOptionalJsonBody } from "@/lib/server/request-body";
import { announceStaffMatchAction, staffActionAuthor } from "@/lib/server/tournaments/staff-action-logs";

/** Refus codés du service, et leur statut ; tout autre échec est un 500. */
const REPLAY_ERROR_STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  NOT_MATCH_CASTER: 403,
  INVALID_REPLAY_URL: 400,
  MATCH_NOT_REPLAYABLE: 409,
};

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Pose (ou efface) le lien YouTube de la rediff d'un match terminé.
 * Corps : `{ replayUrl: string | null }` — `null` (ou chaîne vide) efface ;
 * un corps illisible, vide ou sans la clé est refusé (400), jamais un effacement.
 *
 * Réservé à la permission `live` (admin, arbitre, caster), comme la diffusion
 * en direct dont la rediff est la suite : la seule `live` ne règle que la rediff
 * de **son** cast (403 `NOT_MATCH_CASTER`), le staff `tournaments` toutes.
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "live")) return fail("FORBIDDEN", 403);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  // Un corps illisible (JSON cassé, trop lourd, mauvais type), vide ou sans
  // `replayUrl` est refusé, jamais pris pour un effacement du lien.
  const read = await readOptionalJsonBody(req, "INVALID_REPLAY_URL");
  if ("refusal" in read) return fail(read.refusal, 400);
  const body = read.body;
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("replayUrl" in body)) {
    return fail("INVALID_REPLAY_URL", 400);
  }
  const raw = (body as { replayUrl: unknown }).replayUrl ?? null;
  if (raw !== null && typeof raw !== "string") return fail("INVALID_REPLAY_URL", 400);

  try {
    const { replayUrl, changed } = await setMatchReplayUrl(matchId, raw, {
      userId: user.id,
      manages: can(user, "tournaments"),
    });
    // Un geste sans effet (retirer un lien jamais posé, reposer le même) ne se journalise pas.
    if (changed) {
      announceStaffMatchAction(matchId, replayUrl === null ? "REPLAY_REMOVED" : "REPLAY_SET", staffActionAuthor(user));
    }
    return ok({ replayUrl });
  } catch (error) {
    const message = (error as Error).message;
    const status = REPLAY_ERROR_STATUSES[message];
    return status === undefined ? fail("MATCH_REPLAY_UPDATE_FAILED", 500) : fail(message, status);
  }
}
