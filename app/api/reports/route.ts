import { getCurrentUser } from "@/lib/server/auth";
import { REPORT_SUBMIT_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { createReport } from "@/lib/server/content-reports";
import { validateReportSubmission } from "@/lib/shared/content-reports";
import { can } from "@/lib/shared/permissions";

/**
 * Signalement d'un problème à l'association, **ouvert à tous** : un titulaire
 * de droits n'a pas de compte sur le site, et c'est justement à lui que la
 * notification d'un contenu illicite doit rester possible.
 *
 * Corps : voir `validateReportSubmission` (`lib/shared/content-reports.ts`),
 * unique validation, partagée avec le formulaire.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser().catch(() => null);

  const body = await req.json().catch(() => null);
  const validation = validateReportSubmission(body);
  if (!validation.ok) return fail(validation.error, 400);

  // Après la validation de forme, comme les autres routes : un corps invalide
  // ne consomme pas le quota de quelqu'un qui aura à corriger sa saisie.
  const limited = enforceRateLimit(REPORT_SUBMIT_RULE, user ? `user:${user.id}` : requestClientIp(req));
  if (limited) return limited;

  try {
    const id = await createReport(validation.value, {
      userId: user?.id ?? null,
      managesTournaments: can(user, "tournaments"),
    });
    return ok({ id }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "REPORT_TARGET_NOT_FOUND") return fail(message, 400);
    if (message === "REPORT_CONTEST_LOGIN_REQUIRED" || message === "REPORT_TARGETS_REQUIRE_LOGIN") {
      return fail(message, 401);
    }
    // Même refus pour un signalement inexistant et pour un signalement qui ne
    // vise pas l'appelant : les identifiants sont consécutifs.
    if (message === "REPORT_NOT_CONCERNED") return fail(message, 403);
    if (message === "REPORTS_SATURATED") return fail(message, 429);
    console.error("[reports] envoi impossible", error);
    return fail("REPORT_FAILED", 500);
  }
}
