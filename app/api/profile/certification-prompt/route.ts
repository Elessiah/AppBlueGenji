/**
 * « Ne plus voir » de l'invitation à certifier de la fiche tournoi
 * (`docs/features/CERTIFICATION_PROMPT.md`).
 *
 * `POST` — gardé sur **le compte** de la session (`bg_users.certification_prompt_dismissed_at`,
 * date du premier choix) : la modale ne s'ouvre plus pour ce compte, sur aucun
 * appareil, et jamais pour un autre compte du même navigateur. Rejoué, il
 * n'écrit rien. Provenance vérifiée par le middleware. Il n'existe pas de
 * geste pour la réafficher : la certification reste offerte dans « Mon profil ».
 */
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { recordCertificationPromptOff } from "@/lib/server/tournaments/certification-prompt";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
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
