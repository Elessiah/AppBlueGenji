import type { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { recordRecruitmentModalOff } from "@/lib/server/users/recruitment-modal-preference";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import {
  RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE,
  RECRUITMENT_MODAL_OFF_COOKIE,
  RECRUITMENT_MODAL_OFF_MAX_AGE,
  RECRUITMENT_MODAL_OFF_VALUE,
} from "@/lib/shared/recruitment";

/**
 * Repose le cookie du navigateur par `Set-Cookie`, quelle que soit l'issue :
 * Safari / iOS (ITP) borne à sept jours un cookie posé par script, pas celui
 * qu'envoie le site. Mêmes attributs que celui du client (lisible par lui,
 * `sameSite=lax`), `secure` en production.
 */
function withOptOutCookie<T>(response: NextResponse<T>): NextResponse<T> {
  response.cookies.set(RECRUITMENT_MODAL_OFF_COOKIE, RECRUITMENT_MODAL_OFF_VALUE, {
    path: "/",
    maxAge: RECRUITMENT_MODAL_OFF_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });
  return response;
}

/**
 * « Ne plus afficher » sur la modale d'arrivée du recrutement
 * (`docs/features/RECRUITMENT.md` § Ne plus afficher). Sans corps. Appelée
 * connecté ou non : elle repose toujours le cookie du navigateur
 * (`RECRUITMENT_MODAL_OFF_COOKIE`) et, connecté, écrit le choix sur le compte
 * (`{ account: true }` ; sans session, `{ account: false }` — le choix suivra
 * le compte à la connexion). Une panne — lecture de la session comprise — rend
 * un code, cookie reposé. Écriture de `/api/` : la provenance est vérifiée
 * par le middleware, comme pour toute autre.
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return withOptOutCookie(ok({ account: false }));
    // Déjà posé (lu avec la session) : aucune écriture de plus sur la ligne du compte.
    if (user.recruitmentModalOff) return withOptOutCookie(ok({ account: true }));
    if (!(await recordRecruitmentModalOff(user.id))) return withOptOutCookie(fail(ACCOUNT_DELETED_ERROR, 409));
    return withOptOutCookie(ok({ account: true }));
  } catch (error) {
    // Colonne absente (son `ALTER` a échoué au démarrage) : le rattrapage de la
    // mise en page est éteint lui aussi, le compte ne recevra pas le choix —
    // un code à part, pour que le toast ne promette que ce navigateur.
    if (isUnknownColumnError(error)) return withOptOutCookie(fail(RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE, 503));
    console.error("[recruitment] POST modal-dismiss failed:", error);
    return withOptOutCookie(fail("RECRUITMENT_MODAL_DISMISS_FAILED", 500));
  }
}
