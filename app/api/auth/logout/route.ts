import { clearSession } from "@/lib/server/auth";
import { ok } from "@/lib/server/http";

export async function POST() {
  await clearSession();
  return ok({ success: true });
}
