import type { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { recordRecruitmentModalBackOn, recordRecruitmentModalOff } from "@/lib/server/users/recruitment-modal-preference";
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
    ...optOutCookieAttributes(),
    maxAge: RECRUITMENT_MODAL_OFF_MAX_AGE,
  });
  return response;
}

/**
 * Attributs communs à la pose et à l'effacement du cookie : un effacement qui
 * n'aurait pas les mêmes (chemin, `Secure`…) laisserait l'autre en place.
 */
function optOutCookieAttributes() {
  return {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  } as const;
}

/**
 * Efface le cookie de ce navigateur (`maxAge` 0, mêmes attributs que
 * {@link withOptOutCookie}, faute de quoi le navigateur garderait l'autre).
 */
function withoutOptOutCookie<T>(response: NextResponse<T>): NextResponse<T> {
  response.cookies.set(RECRUITMENT_MODAL_OFF_COOKIE, "", { ...optOutCookieAttributes(), maxAge: 0 });
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

/**
 * Réafficher la modale, depuis « Mon profil » (`docs/features/RECRUITMENT.md`
 * § Réafficher). Connecté seulement (401 sinon). Le compte passe à « réaffichée »
 * (`recordRecruitmentModalBackOn`) et le cookie **de ce navigateur** est
 * effacé ; un autre navigateur qui le garde ne tait la modale que chez lui et
 * ne le reporte plus sur le compte. Rien n'est effacé si l'écriture échoue
 * (le profil garde l'ancien état). Provenance vérifiée par le middleware.
 */
export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return fail("UNAUTHORIZED", 401);
    // Déjà réaffichée (lu avec la session) : seul le cookie d'ici est effacé.
    if (user.recruitmentModalBackOn) return withoutOptOutCookie(ok({ account: true }));
    if (!(await recordRecruitmentModalBackOn(user.id))) return fail(ACCOUNT_DELETED_ERROR, 409);
    return withoutOptOutCookie(ok({ account: true }));
  } catch (error) {
    if (isUnknownColumnError(error)) return fail(RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE, 503);
    console.error("[recruitment] DELETE modal-dismiss failed:", error);
    return fail("RECRUITMENT_MODAL_RESTORE_FAILED", 500);
  }
}
