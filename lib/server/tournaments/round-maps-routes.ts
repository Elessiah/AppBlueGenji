import { getCurrentUser, type AuthUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";

/** Corps JSON d'un réglage des cartes : champs lus un à un par le service. */
export type RoundMapsBody = Readonly<Record<string, unknown>>;

/**
 * Porte commune des réglages de cartes d'un tournoi (`docs/features/ROUND_MAPS.md`) :
 * session (401), permission `tournaments` (403), identifiant du tournoi (400
 * `INVALID_TOURNAMENT_ID`), corps JSON, puis le service (qui reçoit l'auteur,
 * pour l'audit pm2) ; un refus connu rend
 * son code (`statuses`), toute autre erreur `fallback` en 500 (`launchFailure`).
 */
export async function roundMapsStaffPut<T>(
  req: Request,
  context: { params: Promise<{ id: string }> },
  statuses: Readonly<Record<string, number>>,
  fallback: string,
  run: (tournamentId: number, body: RoundMapsBody, user: AuthUser) => Promise<T>,
) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return read.refusal;
  const raw = read.body;
  const body: RoundMapsBody = typeof raw === "object" && raw !== null ? (raw as RoundMapsBody) : {};
  try {
    return ok(await run(tournamentId, body, user));
  } catch (error) {
    return launchFailure(error, statuses, fallback);
  }
}
