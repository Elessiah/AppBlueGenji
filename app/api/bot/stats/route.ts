import { fetchBotStats } from "@/lib/server/bot-integration";
import { ok } from "@/lib/server/http";

export async function GET() {
  const stats = await fetchBotStats();
  return ok(stats);
}
