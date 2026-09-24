import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { recordTermsAcceptance } from "@/lib/server/terms-acceptance";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";

/**
 * Acceptation des conditions d'utilisation par un compte connecté — la modale
 * présentée à qui vient de recevoir la main sur une équipe.
 *
 * Corps : `{ version: number }`, la version **montrée**. Une autre que la
 * version en vigueur est refusée : on n'enregistre pas l'acceptation d'un texte
 * que l'écran n'a pas affiché (onglet resté ouvert pendant une mise à jour).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const body = (await req.json().catch(() => ({}))) as { version?: unknown };
  if (body.version !== TERMS_VERSION) return fail("TERMS_VERSION_MISMATCH", 409);

  if (!(await recordTermsAcceptance(user.id, "TEAM_MANAGEMENT"))) return fail("PROFILE_NOT_FOUND", 404);
  return ok({ version: TERMS_VERSION });
}
