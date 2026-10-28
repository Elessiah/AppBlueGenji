/**
 * « Ne plus voir » de l'invitation à certifier de la fiche tournoi
 * (`docs/features/CERTIFICATION_PROMPT.md`).
 *
 * `POST` — gardé sur **le compte** de la session (`bg_users.certification_prompt_dismissed_at`,
 * date du premier choix) : la modale ne s'ouvre plus pour ce compte, sur aucun
 * appareil, et jamais pour un autre compte du même navigateur. Rejoué, il
 * n'écrit rien. Provenance vérifiée par le middleware.
 *
 * Le corps porte le compte à qui la modale a été montrée (`{ userId }`) : une
 * session changée depuis (autre compte connecté dans un autre onglet) répond
 * 409 `CERTIFY_PROMPT_OTHER_ACCOUNT` sans rien écrire ; un corps sans compte
 * lisible, 400 `INVALID_ACTION`. Il n'existe pas de
 * geste pour la réafficher : la certification reste offerte dans « Mon profil ».
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { readJsonBody, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { recordCertificationPromptOff } from "@/lib/server/tournaments/certification-prompt";
import { CERTIFY_PROMPT_OTHER_ACCOUNT, parseCertifyPromptUserId } from "@/lib/shared/discord-certify-prompt";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  let shownTo: number | null;
  try {
    const body = (await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES)) as { userId?: unknown } | null;
    shownTo = parseCertifyPromptUserId(body?.userId);
  } catch {
    shownTo = null;
  }
  if (shownTo == null) return fail("INVALID_ACTION", 400);
  if (shownTo !== user.id) return fail(CERTIFY_PROMPT_OTHER_ACCOUNT, 409);
  try {
    await recordCertificationPromptOff(user.id);
    return ok({ saved: true });
  } catch (error) {
    // Colonne absente : le choix ne peut pas être gardé (la modale se rouvrira).
    if (isUnknownColumnError(error)) return fail("CERTIFICATION_PROMPT_UNAVAILABLE", 503);
    console.error("[tournaments] POST certification-prompt failed:", error);
    return fail("CERTIFICATION_PROMPT_FAILED", 500);
  }
}
