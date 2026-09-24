import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getConcernedReport } from "@/lib/server/content-reports";

/**
 * Un signalement, lu par une personne qu'il vise (joueur désigné, ou membre
 * d'une équipe désignée) — la page vers laquelle mène le message privé qui l'a
 * prévenue. Rien du signalant n'en sort.
 *
 * **404** pour un signalement qui n'existe pas **et** pour un signalement qui ne
 * vise pas l'appelant : répondre « interdit » confirmerait son existence.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) return fail("REPORT_NOT_FOUND", 404);

  const report = await getConcernedReport(reportId, user.id);
  if (!report) return fail("REPORT_NOT_FOUND", 404);
  return ok({ report });
}
