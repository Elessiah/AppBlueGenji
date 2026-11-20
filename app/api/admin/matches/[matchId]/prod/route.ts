import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { isPositiveId, launchFailure, parseMatchIdParam } from "@/lib/server/tournaments/match-launch-routes";
import { assignMatchProd, loadProdPanel } from "@/lib/server/tournaments/match-prod";
import { can } from "@/lib/shared/permissions";
import { staffActor } from "@/lib/shared/log-privacy";

const STATUSES: Readonly<Record<string, number>> = {
  MATCH_NOT_FOUND: 404,
  MATCH_ALREADY_COMPLETED: 409,
  MATCH_NOT_LAUNCHABLE: 409,
  PROD_NOT_ELIGIBLE: 409,
  PROD_UNAVAILABLE: 409,
  PROD_IS_PLAYER: 409,
  PROD_IS_CASTER: 409,
  PROD_CHANGED: 409,
};

/**
 * Fenêtre « Prod du match » (`docs/features/MATCH_PROD.md`) : la prod actuelle
 * et les comptes qui peuvent l'être. Réservée au staff (permission `tournaments`).
 */
export async function GET(_req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  try {
    const panel = await loadProdPanel(matchId);
    if (!panel) return fail("MATCH_NOT_FOUND", 404);
    return ok({ panel });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_PROD_PANEL_FAILED");
  }
}

/**
 * Place la prod du match, la change ou la retire. Corps :
 * `{ userId: number | null, expectedUserId?: number | null }` — `userId`
 * obligatoire (`null` : retirer ; absent : 400 `INVALID_USER_ID`). Le compte placé
 * tient la permission `prod` (409 `PROD_NOT_ELIGIBLE`), n'est pas suspendu
 * (409 `PROD_UNAVAILABLE`), ne joue pas le match et n'en est pas caster.
 * `expectedUserId` : la prod que la fenêtre montrait ; changée depuis, rien ne
 * change (409 `PROD_CHANGED`).
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const matchId = parseMatchIdParam((await context.params).matchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const read = await readJsonBodyOrFallback(req, {});
  if ("refusal" in read) return read.refusal;
  const body = read.body as { userId?: unknown; expectedUserId?: unknown };
  // Clé absente (corps vide, faute de frappe) : jamais lue comme un retrait.
  if (!("userId" in body)) return fail("INVALID_USER_ID", 400);
  const prodId = body.userId ?? null;
  if (prodId !== null && !isPositiveId(prodId)) return fail("INVALID_USER_ID", 400);
  const expected = body.expectedUserId;
  if (expected !== undefined && expected !== null && !isPositiveId(expected)) return fail("INVALID_USER_ID", 400);

  try {
    await assignMatchProd(matchId, staffActor(user), prodId, expected);
    return ok({ prodAssigned: prodId !== null });
  } catch (error) {
    return launchFailure(error, STATUSES, "MATCH_PROD_ASSIGN_FAILED");
  }
}
