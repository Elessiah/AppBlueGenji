import { getCurrentUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { PLAYER_VIEW_NO_SESSION, setPlayerView } from "@/lib/server/player-view";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { parsePlayerViewBody } from "@/lib/shared/player-view";

/**
 * « Passer en vue joueur » / « Revenir en vue admin »
 * (`docs/features/ADMIN_PLAYER_VIEW.md`). Corps `{ active: boolean }`.
 *
 * Ouverte aux seuls comptes qui portent **réellement** des droits de
 * plateforme (`playerViewAvailable`, lu sur le compte et non sur la session) :
 * c'est ce qui laisse revenir une session en vue joueur, dont `can()` ne voit
 * plus aucun droit. Un joueur sans rôle reçoit `403 FORBIDDEN`.
 */
export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.playerViewAvailable) return fail("FORBIDDEN", 403);

  const read = await readJsonObject(req, "INVALID_PLAYER_VIEW", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const active = parsePlayerViewBody(read.body);
  if (active === null) return fail("INVALID_PLAYER_VIEW", 400);

  try {
    const { until } = await setPlayerView(user, active);
    // L'état relu en base, pas celui demandé : deux bascules croisées ne
    // peuvent rendre « vue joueur » sans échéance.
    return ok({ playerView: until !== null, until });
  } catch (error) {
    if (error instanceof Error && error.message === PLAYER_VIEW_NO_SESSION) return fail("UNAUTHORIZED", 401);
    console.error("[player-view] bascule impossible :", failureReason(error));
    return fail("PLAYER_VIEW_FAILED", 500);
  }
}
