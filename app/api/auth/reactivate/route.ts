import { cookies } from "next/headers";
import { createSession } from "@/lib/server/auth";
import { AccountSuspendedError, assertNotSuspended } from "@/lib/server/account-suspensions";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { fail, ok } from "@/lib/server/http";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import {
  peekReactivationTicket,
  reactivateAccount,
  REACTIVATION_COOKIE,
} from "@/lib/server/users/account-reactivation";

/**
 * Réactive le compte désigné par le ticket de réactivation (cookie posé par la
 * connexion, `createSession`) et ouvre sa session — le seul geste qui relève
 * une demande de suppression (E4). Le ticket sert une fois.
 */
export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const cookieStore = await cookies();
  const token = cookieStore.get(REACTIVATION_COOKIE)?.value;
  cookieStore.delete(REACTIVATION_COOKIE);
  try {
    // Suspension contrôlée **avant** de relever la demande : sinon le compte
    // revivrait sans session, et la demande de suppression serait perdue.
    const pending = await peekReactivationTicket(token);
    if (pending) await assertNotSuspended(pending.userId);
    const reactivated = await reactivateAccount(token);
    if (!reactivated) return fail("REACTIVATION_EXPIRED", 410);
    await createSession(reactivated.userId, reactivated.event);
    return ok({ reactivated: true });
  } catch (error) {
    if (error instanceof AccountSuspendedError) return fail(ACCOUNT_SUSPENDED, 403, { suspension: error.notice });
    console.error("[auth] réactivation impossible", error instanceof Error ? error.message : error);
    return fail("REACTIVATION_FAILED", 500);
  }
}
