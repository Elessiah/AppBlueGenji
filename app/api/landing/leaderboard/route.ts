import { ok } from "@/lib/server/http";
import { getLandingLeaderboard } from "@/lib/server/landing-service";

export const revalidate = 300;
export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? "8");
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const game = (url.searchParams.get("game") ?? "all").trim();
  const limit = parseLimit(url.searchParams.get("limit"));

  if (game !== "all") {
    console.warn(`[landing/leaderboard] game=${game} is currently ignored`);
  }

  const leaderboard = await getLandingLeaderboard(limit);
  return ok({ leaderboard });
}
