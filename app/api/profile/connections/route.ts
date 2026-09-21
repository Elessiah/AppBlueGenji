/**
 * Les moyens de connexion du compte : « Applications connectées », sur `/profil`.
 *
 * Lecture seule. L'**ajout** ne passe pas par ici mais par
 * `/api/auth/<slug>/start?intent=link` — il faut un aller-retour chez le
 * fournisseur, donc une redirection du navigateur, pas un appel de fond ; le
 * retrait, lui, est un `DELETE` sur `./[provider]`.
 *
 * Séparé de `GET /api/profile`, qui rend la fiche entière, pour la même raison
 * que l'état Discord l'est déjà : cette liste change sans que la fiche change
 * (un rattachement n'y touche à rien d'autre), et l'écran la relit seul au retour
 * d'un aller-retour.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { listAccountConnections } from "@/lib/server/account-identities";
import { fail, ok } from "@/lib/server/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    return ok({ connections: await listAccountConnections(user.id) });
  } catch (error) {
    const message = (error as Error).message || "CONNECTIONS_LOAD_FAILED";
    return fail(message, message === "PROFILE_NOT_FOUND" ? 404 : 500);
  }
}
