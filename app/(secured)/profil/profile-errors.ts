/**
 * Les refus de la **sauvegarde du profil**, dits dans la langue de la page.
 *
 * Distinct du registre de la certification (`discord-errors.ts`) : router les
 * erreurs du profil vers celui-là faisait annoncer « La certification a échoué »
 * à un pseudo déjà pris, à une coupure réseau, à tout ce qui n'était pas prévu.
 * Un repli ne doit jamais affirmer une cause qu'il ne connaît pas.
 *
 * Les codes que la route rend vraiment, et rien d'autre ; le repli reste vague
 * **exprès**, et ne laisse jamais sortir un code en capitales dans un toast.
 *
 * Chaque geste de la page a sa fonction — sauvegarde, lecture, avatar,
 * invitation — parce que c'est le **repli** qui change d'un geste à l'autre :
 * « La sauvegarde a échoué » est faux pour un téléversement d'avatar comme pour
 * une réponse à une invitation. Les codes nommés, eux, se disent pareil partout.
 *
 * Depuis le lot 9-2 de la traduction, les phrases vivent dans l'espace
 * `profile` (`errors.*`) ; chaque fonction prend le texte de la langue en
 * dernier argument, français par défaut. Le français est celui d'avant, code
 * par code (testé).
 */
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";
import type { ProfileInputError } from "@/lib/shared/profile-input-errors";
import type frProfileMessages from "@/messages/fr/profile.json";
import { FR_TEAM_ERRORS_TEXT, imageErrorMessage, membershipErrorMessage, type TeamErrorsText } from "../equipes/_lib/team-errors";
import { FR_PROFILE, lookupCode, type ProfileText } from "./_lib/profile-text";

/**
 * Les refus de saisie, typés sur la liste partagée avec la route : un code
 * ajouté là-bas sans sa phrase dans `profile.errors.write` **ne compile pas**
 * (et casse le test de couverture, `tests/app/profile-reports-uiux.test.tsx`).
 */
type WriteErrorCode = keyof (typeof frProfileMessages)["errors"]["write"];
type InputErrorsCovered = [ProfileInputError] extends [WriteErrorCode] ? true : never;
export const PROFILE_INPUT_ERRORS_COVERED: InputErrorsCovered = true;

/** Le code nommé d'une écriture, ou `null`. */
function namedMessage(text: ProfileText, code: string | null | undefined): string | null {
  return lookupCode(text, "errors.write", code, { max: PSEUDO_MAX_LENGTH }) ?? lookupCode(text, "errors.shared", code);
}

export function profileErrorMessage(code: string | null | undefined, text: ProfileText = FR_PROFILE): string {
  return namedMessage(text, code) ?? text.t("errors.saveFallback");
}

/**
 * Le même registre, avec le repli d'une **lecture**.
 *
 * Les codes nommés ne bougent pas : une session expirée ou un compte
 * introuvable se disent pareil des deux côtés. Encore faut-il qu'ils se disent
 * **sans nommer de geste** — d'où la seule table partagée (`errors.shared`) :
 * « La sauvegarde a échoué » annoncerait à un visiteur qui vient d'ouvrir la
 * page l'échec d'un geste qu'il n'a pas fait.
 */
export function profileLoadErrorMessage(code: string | null | undefined, text: ProfileText = FR_PROFILE): string {
  return lookupCode(text, "errors.shared", code) ?? text.t("errors.loadFallback");
}

/**
 * Un téléversement d'avatar refusé.
 *
 * Les refus d'image d'abord — rédigés une fois pour le logo d'équipe et
 * l'avatar (espace `teamErrors`, table `image`) —, puis les codes du profil
 * (session, compte supprimé), puis un repli qui nomme le geste.
 */
export function avatarUploadErrorMessage(
  code: string | null | undefined,
  text: ProfileText = FR_PROFILE,
  imageText: TeamErrorsText = FR_TEAM_ERRORS_TEXT,
): string {
  return imageErrorMessage(code, imageText) ?? namedMessage(text, code) ?? text.t("errors.avatarUploadFallback");
}

/** Le retrait de l'avatar refusé : aucun fichier en jeu, seul le repli change. */
export function avatarDeleteErrorMessage(code: string | null | undefined, text: ProfileText = FR_PROFILE): string {
  return namedMessage(text, code) ?? text.t("errors.avatarDeleteFallback");
}

/**
 * Une réponse à une invitation d'équipe refusée.
 *
 * Ces refus appartiennent au domaine des **équipes** et ont déjà leur
 * registre : on emprunte sa variante « à la deuxième personne » — c'est le
 * joueur lui-même qui répond —, et un code absent ou inconnu y retombe sur le
 * repli de cette route, qui nomme le geste.
 */
export function invitationResponseErrorMessage(
  code: string | null | undefined,
  text: TeamErrorsText = FR_TEAM_ERRORS_TEXT,
): string {
  return membershipErrorMessage(code, "INVITATION_RESPOND_FAILED", text);
}
