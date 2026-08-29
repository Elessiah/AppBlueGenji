import { ok } from "@/lib/server/http";
import { enforceRateLimit, LANDING_READ_RULE, requestClientIp } from "@/lib/server/api-guard";
import { getLandingStats } from "@/lib/server/landing-service";

/**
 * `revalidate` n'a aucun effet à côté de `force-dynamic` : la route est
 * recalculée à chaque appel. La mutualisation se fait en amont, dans
 * `landing-service` (cache mémoire à vol unique) — d'où un plafond de débit
 * ici, seul rempart restant contre une boucle côté client.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const throttled = enforceRateLimit(LANDING_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const stats = await getLandingStats();
  return ok(stats);
}
