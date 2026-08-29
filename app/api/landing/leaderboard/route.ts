import { ok } from "@/lib/server/http";
import { enforceRateLimit, LANDING_READ_RULE, requestClientIp } from "@/lib/server/api-guard";
import { getLandingLeaderboard } from "@/lib/server/landing-service";

/**
 * `revalidate` n'a aucun effet à côté de `force-dynamic` : la route est
 * recalculée à chaque appel. La mutualisation se fait en amont, dans
 * `landing-service` (cache mémoire à vol unique) — d'où un plafond de débit
 * ici, seul rempart restant contre une boucle côté client.
 */
export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? "8");
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

export async function GET(req: Request) {
  const throttled = enforceRateLimit(LANDING_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const url = new URL(req.url);
  const game = (url.searchParams.get("game") ?? "all").trim();
  const limit = parseLimit(url.searchParams.get("limit"));

  if (game !== "all") {
    console.warn(`[landing/leaderboard] game=${game} is currently ignored`);
  }

  const leaderboard = await getLandingLeaderboard(limit);
  return ok({ leaderboard });
}
