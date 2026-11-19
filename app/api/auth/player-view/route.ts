import { enforceRateLimit, PLAYER_VIEW_TOGGLE_RULE } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { PLAYER_VIEW_NO_SESSION, setPlayerView } from "@/lib/server/player-view";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { parsePlayerViewBody } from "@/lib/shared/player-view";

/**
 * « Incarner un rôle » / « Revenir en vue admin »
 * (`docs/features/ADMIN_ROLE_IMPERSONATION.md`). Corps `{ active: boolean,
 * roles?: PlatformRole[] }` — `roles` à l'entrée seulement : les rôles à
 * incarner (sauf `ADMIN`), vides ou absents pour la vue joueur.
 *
 * Ouverte aux seuls administrateurs **réels** (`playerViewAvailable`, lu sur
 * le compte et non sur la session) : c'est ce qui laisse revenir une session
 * qui incarne un rôle, dont `can()` ne voit plus que ce rôle. Tout autre
 * compte reçoit `403 FORBIDDEN`. Débit borné par compte
 * (`PLAYER_VIEW_TOGGLE_RULE`, `429`).
 */
export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.playerViewAvailable) return fail("FORBIDDEN", 403);
  const throttled = enforceRateLimit(PLAYER_VIEW_TOGGLE_RULE, user.id);
  if (throttled) return throttled;

  const read = await readJsonObject(req, "INVALID_PLAYER_VIEW", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const parsed = parsePlayerViewBody(read.body);
  if (parsed === null) return fail("INVALID_PLAYER_VIEW", 400);

  try {
    const { until, roles } = await setPlayerView(user, parsed.active, parsed.roles);
    // L'état relu en base, pas celui demandé : deux bascules croisées ne
    // peuvent rendre une incarnation sans échéance.
    return ok({ playerView: until !== null, until, roles });
  } catch (error) {
    if (error instanceof Error && error.message === PLAYER_VIEW_NO_SESSION) return fail("UNAUTHORIZED", 401);
    console.error("[player-view] bascule impossible :", failureReason(error));
    return fail("PLAYER_VIEW_FAILED", 500);
  }
}
