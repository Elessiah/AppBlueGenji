import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { loadSeedingBoard, reorderSeeding } from "@/lib/server/tournaments/seeding";
import { can } from "@/lib/shared/permissions";

/** Ordre de seeding courant + fenêtre d'édition. */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const board = await loadSeedingBoard(tournamentId);
  if (!board) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok(board);
}

/**
 * Réordonne le seeding. Corps : `{ teamIds: number[] }` — la liste complète des
 * équipes inscrites, dans le nouvel ordre.
 */
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as { teamIds?: unknown };
  if (!Array.isArray(body.teamIds) || body.teamIds.length === 0) {
    return fail("INVALID_SEED_ORDER", 400);
  }

  const teamIds = body.teamIds.map(Number);
  if (teamIds.some((teamId) => !Number.isInteger(teamId) || teamId <= 0)) {
    return fail("INVALID_SEED_ORDER", 400);
  }

  try {
    await reorderSeeding(tournamentId, teamIds);
    const board = await loadSeedingBoard(tournamentId);
    return ok(board);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    if (message === "SEEDING_LOCKED") return fail(message, 409);
    if (message === "INVALID_SEED_ORDER") return fail(message, 400);
    return fail(message || "SEEDING_REORDER_FAILED", 500);
  }
}
