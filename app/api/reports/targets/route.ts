import { getCurrentUser } from "@/lib/server/auth";
import { REPORT_TARGET_SEARCH_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { resolveReportTargets, searchReportTargets } from "@/lib/server/content-reports";
import { REPORT_MAX_TARGETS, isReportTargetType } from "@/lib/shared/content-reports";
import { can } from "@/lib/shared/permissions";

/**
 * Propositions du sélecteur de cibles du formulaire de signalement.
 *
 * `?type=USER|TEAM|TOURNAMENT&q=<texte>` cherche par nom ;
 * `?type=…&ids=1,2` résout des identifiants (la fiche d'où l'on signale).
 *
 * **Réservé aux comptes connectés.** L'annuaire des joueurs et des équipes est
 * derrière une connexion ; une recherche ouverte à tous le rendrait lisible par
 * morceaux à n'importe qui. Un visiteur sans compte décrit ce qu'il signale et
 * le formulaire retient la page d'où il écrit.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const limited = enforceRateLimit(REPORT_TARGET_SEARCH_RULE, user.id);
  if (limited) return limited;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  if (!isReportTargetType(type)) return fail("INVALID_TARGET_TYPE", 400);
  const viewer = { userId: user.id, managesTournaments: can(user, "tournaments") };

  const idsParam = url.searchParams.get("ids");
  if (idsParam !== null) {
    const ids = [...new Set(idsParam.split(",").map(Number))]
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .slice(0, REPORT_MAX_TARGETS);
    const options = await resolveReportTargets(ids.map((id) => ({ type, id })), viewer);
    return ok({ options });
  }

  const options = await searchReportTargets(type, url.searchParams.get("q") ?? "", viewer);
  return ok({ options });
}
