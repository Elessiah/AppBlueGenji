import { cookies } from "next/headers";
import { createSession } from "@/lib/server/auth";
import { AccountSuspendedError } from "@/lib/server/account-suspensions";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { REACTIVATED_LOGIN_REQUIRED } from "@/lib/shared/account-deletion";
import { fail, ok } from "@/lib/server/http";
import { isProductionCookieEnv } from "@/lib/shared/auth-cookies";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import {
  discardReactivationTicket,
  reactivateAccount,
  reactivationCookieName,
} from "@/lib/server/users/account-reactivation";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Efface le cookie du ticket, avec les attributs de sa pose : un `__Host-` sans
 * `Secure` serait refusé par le navigateur, et le ticket resterait.
 */
function clearTicketCookie(cookieStore: CookieStore): void {
  cookieStore.set(reactivationCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionCookieEnv(),
    path: "/",
    maxAge: 0,
  });
}

/**
 * Réactive le compte désigné par le ticket de réactivation (cookie posé par la
 * connexion, `createSession`) et ouvre sa session — le seul geste qui relève
 * une demande de suppression (E4). Le ticket sert une fois.
 *
 * Le cookie n'est retiré que lorsque le ticket n'a plus d'objet (réactivation
 * faite, ticket périmé ou déjà servi) : une panne passagère **avant** la
 * réactivation annule la transaction, le ticket revient, et le même écran
 * réessaie sans repasser par la connexion.
 */
export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const cookieStore = await cookies();
  const token = cookieStore.get(reactivationCookieName())?.value;
  let reactivated: Awaited<ReturnType<typeof reactivateAccount>>;
  try {
    // Un compte suspendu se réactive aussi (décision du 2026-11-04) : la
    // demande est relevée, il revient suspendu, et la porte dit la suspension
    // (`reactivated: true` : l'écran annonce aussi la réactivation).
    reactivated = await reactivateAccount(token);
  } catch (error) {
    console.error("[auth] réactivation impossible", error instanceof Error ? error.message : error);
    return fail("REACTIVATION_FAILED", 500);
  }
  clearTicketCookie(cookieStore);
  if (!reactivated) return fail("REACTIVATION_EXPIRED", 410);
  const { pseudoChanged } = reactivated;
  try {
    await createSession(reactivated.userId, reactivated.event);
  } catch (error) {
    if (error instanceof AccountSuspendedError) {
      return fail(ACCOUNT_SUSPENDED, 403, { suspension: error.notice, reactivated: true, pseudoChanged });
    }
    // Le compte est réactivé et le ticket servi : dire un échec enverrait le
    // joueur réessayer un ticket « expiré ». Il lui reste à se connecter.
    console.error("[auth] session non ouverte après réactivation", error instanceof Error ? error.message : error);
    return fail(REACTIVATED_LOGIN_REQUIRED, 503, { reactivated: true, pseudoChanged });
  }
  return ok({ reactivated: true, pseudoChanged });
}

/**
 * « Ne pas réactiver » : retire le ticket et son cookie, sans toucher à la
 * demande de suppression, qui suit son cours. Sur un poste partagé, le cookie
 * resterait sinon utilisable jusqu'à son terme. Au mieux : le cookie part même
 * si la base ne répond pas (le ticket expire alors de lui-même).
 */
export async function DELETE(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const cookieStore = await cookies();
  const token = cookieStore.get(reactivationCookieName())?.value;
  clearTicketCookie(cookieStore);
  try {
    await discardReactivationTicket(token);
  } catch (error) {
    console.error("[auth] ticket de réactivation non retiré", error instanceof Error ? error.message : error);
  }
  return ok({ discarded: true });
}
