import { ok } from "@/lib/server/http";
import { getLandingStats } from "@/lib/server/landing-service";

export const revalidate = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getLandingStats();
  return ok(stats);
}
