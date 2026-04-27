import { ok } from "@/lib/server/http";
import { getLandingLive } from "@/lib/server/landing-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const live = await getLandingLive();
  return ok({ live });
}
