import { ok } from "@/lib/server/http";
import { getLandingTicker } from "@/lib/server/landing-service";

export const revalidate = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getLandingTicker();
  return ok(payload);
}
