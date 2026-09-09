import { BOT_READ_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { fetchBotStats } from "@/lib/server/bot-integration";
import { ok } from "@/lib/server/http";

export async function GET(req: Request) {
  // Route publique (`/bot` est une page de vitrine) : le plafond porte donc sur
  // l'IP, faute de compte à qui l'imputer.
  const throttled = enforceRateLimit(BOT_READ_RULE, requestClientIp(req));
  if (throttled) return throttled;

  const stats = await fetchBotStats();
  return ok(stats);
}
