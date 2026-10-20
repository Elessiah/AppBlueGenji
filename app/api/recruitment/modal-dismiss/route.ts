import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { recordRecruitmentModalOff } from "@/lib/server/users/recruitment-modal-preference";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";

/**
 * « Ne plus afficher » sur la modale d'arrivée du recrutement, pour le compte
 * connecté (`docs/features/RECRUITMENT.md` § Ne plus afficher). Sans corps.
 * Le navigateur pose lui-même son cookie (`RECRUITMENT_MODAL_OFF_COOKIE`) ;
 * non connecté, il n'appelle pas cette route, et le choix suivra le compte à
 * la connexion. Écriture de `/api/` : la provenance est vérifiée par le
 * middleware, comme pour toute autre.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  try {
    if (!(await recordRecruitmentModalOff(user.id))) return fail(ACCOUNT_DELETED_ERROR, 409);
    return ok({ off: true });
  } catch (error) {
    console.error("[recruitment] POST modal-dismiss failed:", error);
    return fail("RECRUITMENT_MODAL_DISMISS_FAILED", 500);
  }
}
