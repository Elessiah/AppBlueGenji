import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { listReports } from "@/lib/server/content-reports";
import { can } from "@/lib/shared/permissions";

/** Signalements conservés, pour le panneau d'administration (`moderation`). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const reports = await listReports();
  return ok({ reports });
}
