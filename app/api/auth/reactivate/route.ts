import { cookies } from "next/headers";
import { createSession } from "@/lib/server/auth";
import { AccountSuspendedError } from "@/lib/server/account-suspensions";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { fail, ok } from "@/lib/server/http";
import { isProductionCookieEnv } from "@/lib/shared/auth-cookies";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { reactivateAccount, reactivationCookieName } from "@/lib/server/users/account-reactivation";

/**
 * Réactive le compte désigné par le ticket de réactivation (cookie posé par la
 * connexion, `createSession`) et ouvre sa session — le seul geste qui relève
 * une demande de suppression (E4). Le ticket sert une fois.
 */
export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const cookieStore = await cookies();
  const cookieName = reactivationCookieName();
  const token = cookieStore.get(cookieName)?.value;
  // Effacé avec les attributs de sa pose : un `__Host-` sans `Secure` serait
  // refusé par le navigateur, et le ticket resterait.
  cookieStore.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionCookieEnv(),
    path: "/",
    maxAge: 0,
  });
  try {
    // Un compte suspendu se réactive aussi (décision du 2026-11-04) : la
    // demande est relevée, il revient suspendu, et la porte dit la suspension
    // (`reactivated: true` : l'écran annonce aussi la réactivation).
    const reactivated = await reactivateAccount(token);
    if (!reactivated) return fail("REACTIVATION_EXPIRED", 410);
    try {
      await createSession(reactivated.userId, reactivated.event);
    } catch (error) {
      if (error instanceof AccountSuspendedError) {
        return fail(ACCOUNT_SUSPENDED, 403, { suspension: error.notice, reactivated: true });
      }
      throw error;
    }
    return ok({ reactivated: true });
  } catch (error) {
    console.error("[auth] réactivation impossible", error instanceof Error ? error.message : error);
    return fail("REACTIVATION_FAILED", 500);
  }
}
