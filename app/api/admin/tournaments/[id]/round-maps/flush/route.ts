import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { flushRoundMapsNotice } from "@/lib/server/tournaments/round-maps-notice";
import { can } from "@/lib/shared/permissions";
import { ROUND_MAPS_FLUSH_ROUNDS_MAX } from "@/lib/shared/round-maps";

const ROUND_KEY_PATTERN = /^\d{1,9}:[A-Z_]{1,16}:\d{1,4}$/;

/**
 * Manches que l'écran déclare avoir écrites (corps `{ rounds: string[] }`) :
 * `undefined` sans corps ni liste (ancien client : tout part), `null` si la
 * liste est mal formée.
 */
async function ownRoundsOf(req: Request): Promise<string[] | null | undefined> {
  const body = (await req.json().catch(() => null)) as { rounds?: unknown } | null;
  if (body === null || body.rounds === undefined) return undefined;
  const { rounds } = body;
  if (!Array.isArray(rounds) || rounds.length > ROUND_MAPS_FLUSH_ROUNDS_MAX) return null;
  if (!rounds.every((key) => typeof key === "string" && ROUND_KEY_PATTERN.test(key))) return null;
  return rounds as string[];
}

/**
 * Fermeture de l'écran des cartes : envoie tout de suite l'annonce Discord en
 * attente (`round-maps-notice.ts`). Un simple accélérateur — sans cet appel
 * (onglet fermé), la fenêtre de silence échue l'envoie quand même. Le corps
 * liste les manches écrites par l'écran : une annonce qui en porte d'autres
 * (un autre membre du staff règle encore sa série) n'est pas devancée.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);
  const ownRounds = await ownRoundsOf(req);
  if (ownRounds === null) return fail("INVALID_ROUNDS", 400);
  try {
    return ok({ sent: await flushRoundMapsNotice(tournamentId, ownRounds) });
  } catch {
    return fail("ROUND_MAPS_FAILED", 500);
  }
}
