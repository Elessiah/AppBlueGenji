import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setMatchLiveConfig, setMatchOnAir } from "@/lib/server/tournaments/live-streams";
import { isMatchLiveTrigger } from "@/lib/shared/live-streams";
import { can } from "@/lib/shared/permissions";

function parseMatchId(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

function mapLiveError(error: unknown) {
  const message = (error as Error).message;
  if (message === "MATCH_NOT_FOUND") return fail(message, 404);
  if (message === "INVALID_STREAM_URL") return fail(message, 400);
  if (message === "INVALID_LIVE_TRIGGER") return fail(message, 400);
  if (message === "LIVE_TRIGGER_NOT_MANUAL") return fail(message, 409);
  if (message === "MATCH_NOT_LIVE_READY") return fail(message, 409);
  return fail(message || "MATCH_LIVE_UPDATE_FAILED", 500);
}

/**
 * Configure la diffusion d'un match.
 * Corps : `{ trigger: "AUTO" | "MANUAL" | null, liveUrl?: string | null }`.
 * `trigger: null` démarque le match (et efface lien et antenne).
 */
export async function PUT(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "live")) return fail("FORBIDDEN", 403);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await req.json().catch(() => ({}))) as {
    trigger?: unknown;
    liveUrl?: unknown;
  };

  const trigger = body.trigger ?? null;
  if (trigger !== null && !isMatchLiveTrigger(trigger)) {
    return fail("INVALID_LIVE_TRIGGER", 400);
  }
  if (body.liveUrl !== null && body.liveUrl !== undefined && typeof body.liveUrl !== "string") {
    return fail("INVALID_STREAM_URL", 400);
  }

  try {
    await setMatchLiveConfig(matchId, { trigger, liveUrl: (body.liveUrl as string) ?? null });
    return ok({ trigger });
  } catch (error) {
    return mapLiveError(error);
  }
}

/**
 * Ouvre ou ferme l'antenne d'un match en mode `MANUAL`.
 * Corps : `{ onAir: boolean }`.
 */
export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "live")) return fail("FORBIDDEN", 403);

  const { matchId: rawMatchId } = await context.params;
  const matchId = parseMatchId(rawMatchId);
  if (matchId === null) return fail("INVALID_MATCH_ID", 400);

  const body = (await req.json().catch(() => ({}))) as { onAir?: unknown };
  if (typeof body.onAir !== "boolean") return fail("INVALID_ON_AIR", 400);

  try {
    await setMatchOnAir(matchId, body.onAir);
    return ok({ onAir: body.onAir });
  } catch (error) {
    return mapLiveError(error);
  }
}
