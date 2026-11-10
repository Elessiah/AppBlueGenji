import { fail } from "@/lib/server/http";
import { bodyReadRefusal, readJsonBody, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";

/**
 * Lecture commune des deux portes du vidage d'un salon vocal (`docs/features/MATCH_VOICE.md`) :
 * l'arbitrage (`/api/admin/matches/[matchId]/voice/clear`) et l'équipe
 * (`/api/matches/[matchId]/voice/clear`). Corps `{ teamId: number }`. Un corps trop lourd (413)
 * ou non déclaré JSON (415) garde son propre refus ; un JSON illisible ou un `teamId` qui n'est
 * pas un entier positif rend `400 INVALID_TEAM_ID`.
 */
export async function readVoiceClearRequest(
  req: Request,
  rawMatchId: string,
): Promise<{ matchId: number; teamId: number } | { refusal: Response }> {
  const matchId = parseMatchIdParam(rawMatchId);
  if (matchId === null) return { refusal: fail("INVALID_MATCH_ID", 400) };
  let body: unknown;
  try {
    body = await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES);
  } catch (error) {
    return { refusal: fail(bodyReadRefusal(error) ?? "INVALID_TEAM_ID", 400) };
  }
  const teamId = body !== null && typeof body === "object" ? (body as { teamId?: unknown }).teamId : undefined;
  if (typeof teamId !== "number" || !Number.isInteger(teamId) || teamId <= 0) return { refusal: fail("INVALID_TEAM_ID", 400) };
  return { matchId, teamId };
}
