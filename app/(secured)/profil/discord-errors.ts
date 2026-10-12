/**
 * Les refus de la certification Discord, dits dans la langue de la page.
 *
 * Même forme que `app/connexion/_lib/login-errors.ts` — registre pur, testable,
 * repli qui ne laisse jamais sortir un jeton en capitales. Distinct de celui de
 * la connexion parce que les consignes diffèrent : là-bas on propose de passer
 * par Google, ici il n'y a pas d'autre chemin, la certification *est* le geste.
 *
 * Phrases dans l'espace `profile` (`verification.*`, `handleUpdate.*`, lot 9-2) ;
 * texte de la langue en dernier argument, français par défaut.
 *
 * `DISCORD_TAG_LOCKED` n'est **pas** ici, et son absence est la règle : ce
 * registre traduit les refus de `/api/profile/discord`, seule route à laquelle
 * le dialogue de certification parle. Le verrou du tag est rendu par
 * `PATCH /api/profile`, donc traduit par `profile-errors.ts`.
 */
import { FR_PROFILE, lookupCode, type ProfileText } from "./_lib/profile-text";

export function discordVerificationErrorMessage(code: string | null | undefined, text: ProfileText = FR_PROFILE): string {
  return lookupCode(text, "verification.errors", code) ?? text.t("verification.fallback");
}

/**
 * Les refus de « Mettre à jour mon pseudo » (ligne « Bot Discord »).
 *
 * Même bot, mêmes bornes, donc les mêmes refus — mais pas les mêmes phrases
 * partout : celles qui nomment la **certification** mentiraient ici, le geste
 * ne certifie rien. Seules celles-là sont réécrites (`handleUpdate.errors`) ;
 * les autres viennent du registre de la certification, pour n'en tenir qu'une
 * copie.
 */
export function discordHandleUpdateErrorMessage(code: string | null | undefined, text: ProfileText = FR_PROFILE): string {
  return (
    lookupCode(text, "handleUpdate.errors", code) ??
    lookupCode(text, "verification.errors", code) ??
    text.t("handleUpdate.fallback")
  );
}
