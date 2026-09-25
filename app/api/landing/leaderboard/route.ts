import { ok } from "@/lib/server/http";
import { enforceRateLimit, LANDING_READ_RULE, requestClientIp } from "@/lib/server/api-guard";
import { getLandingLeaderboard } from "@/lib/server/landing-service";
import type { TournamentGame } from "@/lib/shared/types";

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

/**
 * `Leaderboard.tsx` envoie `all` / `ow` / `mr` (les pastilles Général /
 * Overwatch / Marvel Rivals) ; la base porte le jeu en majuscules
 * (`TournamentGame`). Toute valeur qui n'est ni « ow » ni « mr » vaut
 * « all » — un paramètre inconnu ne doit pas planter la landing, seulement
 * rendre le classement général.
 */
function parseGame(value: string | null): TournamentGame | undefined {
  switch ((value ?? "all").trim().toLowerCase()) {
    case "ow":
      return "OW";
    case "mr":
      return "MR";
    default:
      return undefined;
  }
}

export async function GET(req: Request) {
  const throttled = enforceRateLimit(LANDING_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const url = new URL(req.url);
  const game = parseGame(url.searchParams.get("game"));
  const limit = parseLimit(url.searchParams.get("limit"));

  const leaderboard = await getLandingLeaderboard(limit, game);
  return ok({ leaderboard });
}
