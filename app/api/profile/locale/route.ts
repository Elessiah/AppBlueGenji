import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { SMALL_JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/server/request-body";
import { INVALID_LOCALE, recordAccountLocale } from "@/lib/server/users/account-locale";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { isLocale } from "@/lib/shared/locales";

/**
 * Choix explicite de la langue du compte, depuis « Mon profil » (lot 9-3) :
 * `{ "locale": "fr" | "en" }`. La langue choisit celle des notifications push
 * (`lib/server/users/account-locale.ts`). Écriture de `/api/` : la provenance
 * est vérifiée par le middleware, comme pour toute autre.
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let locale: unknown;
  try {
    locale = ((await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES)) as { locale?: unknown }).locale;
  } catch {
    // Corps illisible, trop lourd ou non déclaré en JSON : un refus du
    // transport, pas une langue invalide — il n'est rattaché à aucun champ.
    return fail("INVALID_BODY", 400);
  }
  if (!isLocale(locale)) return fail(INVALID_LOCALE, 400);

  try {
    // Compte supprimé entre-temps : rien d'écrit — même code que les autres
    // écritures du profil (`profile-update.ts`, avatar).
    if (!(await recordAccountLocale(user.id, locale))) return fail(ACCOUNT_DELETED_ERROR, 409);
    return ok({ locale });
  } catch (error) {
    console.error("[profile] PUT locale failed:", error);
    return fail("PROFILE_UPDATE_FAILED", 400);
  }
}
