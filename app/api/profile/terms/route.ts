import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { managesTeam, recordTermsAcceptance } from "@/lib/server/terms-acceptance";
import { TERMS_VERSION, TERMS_VERSION_MISMATCH } from "@/lib/shared/terms-of-use";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * Acceptation des conditions d'utilisation par un compte connecté — la fenêtre
 * bloquante présentée à tout compte en retard d'une version (depuis la
 * version 6). Contexte de la preuve : `TEAM_MANAGEMENT` si le compte gère une
 * équipe, `SIGNED_IN` sinon.
 *
 * Corps : `{ version: number }`, la version **montrée**. Une autre que la
 * version en vigueur est refusée : on n'enregistre pas l'acceptation d'un texte
 * que l'écran n'a pas affiché (onglet resté ouvert pendant une mise à jour).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const body = (await readJsonBody(req).catch(() => ({}))) as { version?: unknown };
  if (body.version !== TERMS_VERSION) return fail(TERMS_VERSION_MISMATCH, 409);

  const context = (await managesTeam(user.id)) ? "TEAM_MANAGEMENT" : "SIGNED_IN";
  if (!(await recordTermsAcceptance(user.id, context))) return fail("PROFILE_NOT_FOUND", 404);
  return ok({ version: TERMS_VERSION });
}
