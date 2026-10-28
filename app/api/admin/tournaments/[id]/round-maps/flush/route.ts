import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { flushRoundMapsNotice } from "@/lib/server/tournaments/round-maps-notice";
import { can } from "@/lib/shared/permissions";

/**
 * Fermeture de l'écran des cartes : envoie tout de suite l'annonce Discord en
 * attente (`round-maps-notice.ts`). Un simple accélérateur — sans cet appel
 * (onglet fermé), la fenêtre de silence échue l'envoie quand même.
 */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const tournamentId = parseMatchIdParam((await context.params).id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);
  try {
    return ok({ sent: await flushRoundMapsNotice(tournamentId) });
  } catch {
    return fail("ROUND_MAPS_FAILED", 500);
  }
}
