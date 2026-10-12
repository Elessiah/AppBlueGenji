/**
 * Les refus des routes d'équipe, dits dans la langue de la page.
 *
 * Né pour les seuls gestes d'appartenance (rejoindre, quitter, répondre à une
 * demande), qui remontaient le code brut du serveur dans le toast — un joueur
 * lisait `USER_ALREADY_IN_TEAM` en capitales. La **gestion** de l'équipe avait
 * gardé le défaut : exclure, inviter, changer les rôles, renommer, changer le
 * logo, transférer, attribuer ou dissoudre affichaient toujours le jeton
 * (`ALREADY_INVITED`, `CANNOT_KICK_OWNER`, `MISSING_ROLE`, `FORBIDDEN`…). Tout
 * passe désormais par ce registre : une seule page, un seul vocabulaire.
 *
 * Depuis le lot 9 de la traduction, les phrases vivent dans l'espace
 * `teamErrors` (`messages/<langue>/teamErrors.json`) ; les réponses de l'API
 * restent des **codes**. Le français est celui d'avant, code par code (y
 * compris les refus du sigle, d'une image et du motif de modération, recopiés
 * de leurs registres partagés — `teamTagErrorMessage`,
 * `imageUploadErrorMessage`, `moderationReasonErrorMessage` — et vérifiés
 * égaux par un test). Chaque fonction prend la table de la langue en dernier
 * argument, français par défaut ; un écran la lit par `useTeamErrorsText()`.
 *
 * Même forme que `app/(secured)/tournois/[id]/_lib/error-map.ts` : un registre
 * pur, et un repli qui n'invente rien quand le code est inconnu.
 */
import frTeamErrors from "@/messages/fr/teamErrors.json";
import { SUSPENSION_REASON_MAX_LENGTH, SUSPENSION_REASON_MIN_LENGTH } from "@/lib/shared/account-suspension";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";
import { TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH } from "@/lib/shared/team-name";
import { TEAM_TAG_MAX_LENGTH, TEAM_TAG_MIN_LENGTH } from "@/lib/shared/team-tag";
import { IMAGE_UPLOAD_MAX_BYTES } from "@/lib/shared/uploads";

export type TeamErrorsMessages = typeof frTeamErrors;
export type TeamErrorsText = ScopedText<Leaves<TeamErrorsMessages>>;

/** La table française du paquet — hors fournisseur, tests, écrans français. */
export const FR_TEAM_ERRORS_TEXT: TeamErrorsText = scopedText("fr", frTeamErrors);

type CodeTable = "codes" | "tag" | "image";

/** Bornes citées par les phrases (`{min}`, `{max}`), selon le code. */
function valuesFor(code: string): Record<string, number> | undefined {
  switch (code) {
    case "INVALID_TEAM_NAME":
      return { min: TEAM_NAME_MIN_LENGTH, max: TEAM_NAME_MAX_LENGTH };
    case "MODERATION_REASON_REQUIRED":
    case "MODERATION_REASON_TOO_LONG":
      return { min: SUSPENSION_REASON_MIN_LENGTH, max: SUSPENSION_REASON_MAX_LENGTH };
    case "TEAM_TAG_TOO_SHORT":
    case "TEAM_TAG_TOO_LONG":
      return { min: TEAM_TAG_MIN_LENGTH, max: TEAM_TAG_MAX_LENGTH };
    case "IMAGE_TOO_LARGE":
      return { max: IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024) };
    default:
      return undefined;
  }
}

/** La phrase d'un code dans une table, ou `null` s'il n'y figure pas. */
function lookup(text: TeamErrorsText, table: CodeTable, code: string): string | null {
  // `code in` remonterait la chaîne de prototypes (« constructor ») : on lit
  // la table française, propre, par `Object.hasOwn` — les deux langues ont
  // les mêmes clés (test de parité).
  if (!Object.hasOwn(frTeamErrors[table], code)) return null;
  return text.t(`${table}.${code}` as Leaves<TeamErrorsMessages>, valuesFor(code));
}

/**
 * Message à afficher pour un code de refus.
 *
 * Les refus de forme du sigle ont leur propre table (`tag`), ceux d'une image
 * aussi (`image`, partagée avec l'avatar) : ils sont consultés d'abord. Un
 * code inconnu retombe sur une phrase générique **et non sur le code
 * lui-même** : le jour où le serveur en ajoute un, le joueur lit une phrase,
 * pas un jeton.
 *
 * `fallbackCode` nomme le repli du geste (`INVITATION_RESPOND_FAILED`…) : il
 * sert au code absent **et** au code inconnu — le `TypeError` d'une coupure
 * réseau arrive dans le même `catch` que les refus du serveur, et « L'opération
 * a échoué » ne dirait pas laquelle.
 */
export function teamErrorMessage(
  code: string | null | undefined,
  fallbackCode?: string,
  text: TeamErrorsText = FR_TEAM_ERRORS_TEXT,
): string {
  const fallback = () => (fallbackCode ? lookup(text, "codes", fallbackCode) : null) ?? text.t("fallback");
  if (!code) return fallback();
  return lookup(text, "tag", code) ?? lookup(text, "image", code) ?? lookup(text, "codes", code) ?? fallback();
}

/**
 * Le même registre, pour les gestes que le joueur fait **pour lui-même**
 * (rejoindre, retirer sa demande).
 *
 * Un seul code change de sujet : `USER_ALREADY_IN_TEAM` parle du joueur visé.
 * Quand la gestion invite, c'est l'invité (« ce joueur ») ; quand on demande à
 * rejoindre, c'est soi (« tu »). Le dire à la troisième personne à qui vient de
 * cliquer « Rejoindre » le laisserait chercher de quel joueur il s'agit.
 */
export function membershipErrorMessage(
  code: string | null | undefined,
  fallbackCode?: string,
  text: TeamErrorsText = FR_TEAM_ERRORS_TEXT,
): string {
  if (code === "USER_ALREADY_IN_TEAM") return text.t("selfAlreadyInTeam");
  return teamErrorMessage(code, fallbackCode, text);
}
