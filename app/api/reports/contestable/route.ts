import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { listContestableReports } from "@/lib/server/content-reports";

/** Signalements qui visent l'appelant, ou une équipe dont il est membre (choix de la contestation). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  return ok({ reports: await listContestableReports(user.id) });
}
