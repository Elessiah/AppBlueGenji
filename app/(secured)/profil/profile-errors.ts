/**
 * Les refus de la **sauvegarde du profil**, dits en français.
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
 */

import { ACCOUNT_DELETED_ERROR, ACCOUNT_DELETED_WRITE_MESSAGE } from "@/lib/shared/account-deletion";
import { imageUploadErrorMessage } from "@/lib/shared/image-upload-errors";
import { PSEUDO_MAX_LENGTH } from "@/lib/shared/pseudo";
import type { ProfileInputError } from "@/lib/shared/profile-input-errors";
import { membershipErrorMessage } from "../equipes/_lib/team-errors";

/**
 * Une phrase par refus de saisie — typé sur la liste partagée avec la route,
 * si bien qu'un code ajouté là-bas sans sa phrase ici ne compile pas.
 */
const INPUT_ERRORS: Record<ProfileInputError, string> = {
  // Le corps du `PATCH` n'est qu'annoté : un pseudo qui n'est pas une chaîne
  // faisait lever `normalizePseudo`, et le message du `TypeError` ressortait
  // tel quel. Un formulaire n'envoie jamais que du texte — le cas n'arrive que
  // par un appel direct, d'où une phrase qui ne suppose rien de la saisie.
  INVALID_PSEUDO: "Le pseudo envoyé est invalide. Recharge la page puis réessaie.",
  PSEUDO_EMPTY: "Ton pseudo ne peut pas être vide.",
  PSEUDO_TOO_LONG: `Ton pseudo doit tenir en ${PSEUDO_MAX_LENGTH} caractères au plus.`,
  // Même trou pour le tag : écarté par le service plutôt que de faire lever
  // `.trim()`.
  INVALID_DISCORD_PSEUDO: "Le tag Discord doit être du texte. Ressaisis-le.",
  // Et pour le BattleTag, qu'il faut désormais lire pour le comparer à celui
  // que Blizzard a posé (`lib/shared/battletag-lock.ts`).
  INVALID_OVERWATCH_BATTLETAG: "Le BattleTag doit être du texte. Ressaisis-le.",
};

/** Les refus d'une **écriture** : saisie, état du compte, verrou du tag. */
const WRITE_ERRORS: Record<string, string> = {
  ...INPUT_ERRORS,
  PSEUDO_ALREADY_USED: "Ce pseudo est déjà pris. Choisis-en un autre.",

  // Un compte Discord rattaché possède son tag : il ne peut pas en inventer un
  // autre, mais il peut le retirer. Le message nomme les deux gestes qui
  // existent à l'écran.
  DISCORD_TAG_LOCKED:
    "Ton compte Discord est rattaché : ce tag vient de lui. Renomme-toi sur Discord puis reconnecte-toi pour en changer, ou retire-le.",

  // Le BattleTag suit la même règle avec **un geste de moins** : Blizzard le
  // réécrit à chaque connexion, donc l'effacer ne durerait pas. Ce qui le
  // publie est la case « BattleTag OW », et c'est elle que la phrase nomme.
  BATTLETAG_LOCKED:
    "Ton compte Blizzard est rattaché : ce BattleTag vient de lui. Retire Blizzard depuis « Applications connectées » pour en changer, ou décoche « BattleTag OW » pour cesser de le publier.",

  // La sauvegarde est partie avant la suppression du compte et a attendu son
  // verrou : la phrase dit que **rien** n'a été écrit.
  [ACCOUNT_DELETED_ERROR]: ACCOUNT_DELETED_WRITE_MESSAGE,
};

/**
 * Les codes qui se disent pareil qu'on lise ou qu'on écrive — et qui, pour
 * cette raison, **ne nomment aucun geste**. Le compte supprimé n'en est pas :
 * sa phrase dit qu'une modification n'a pas été enregistrée, ce qu'on ne peut
 * pas annoncer à qui vient seulement d'ouvrir la page.
 */
const SHARED_ERRORS: Record<string, string> = {
  UNAUTHORIZED: "Ta session a expiré. Reconnecte-toi.",
  PROFILE_NOT_FOUND: "Ton compte est introuvable. Reconnecte-toi.",
};

/** Le code nommé du registre, ou `null` : `code in` remonterait la chaîne de prototypes. */
function lookup(registry: Record<string, string>, code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(registry, code) ? registry[code] : null;
}

/** Le code nommé d'une écriture, ou `null`. */
function namedMessage(code: string | null | undefined): string | null {
  return lookup(WRITE_ERRORS, code) ?? lookup(SHARED_ERRORS, code);
}

export function profileErrorMessage(code: string | null | undefined): string {
  return namedMessage(code) ?? SAVE_FALLBACK;
}

const SAVE_FALLBACK = "La sauvegarde a échoué. Réessaie dans un instant.";
const LOAD_FALLBACK = "Impossible de charger ton profil. Réessaie dans un instant.";

/**
 * Le même registre, avec le repli d'une **lecture**.
 *
 * Les codes nommés ne bougent pas : une session expirée ou un compte
 * introuvable se disent pareil des deux côtés, et les dupliquer les ferait
 * diverger. Encore faut-il qu'ils se disent **sans nommer de geste** :
 * « Reconnecte-toi pour *modifier* ton profil » annonçait au visiteur qui vient
 * d'ouvrir la page une action qu'il n'a pas faite — le défaut même que cette
 * séparation corrige, revenu par le partage. Ce qui change est le seul repli, qui est précisément la phrase
 * qu'on prononce quand on ne sait pas — et « La sauvegarde a échoué » annonçait
 * alors à un visiteur qui vient d'ouvrir la page l'échec d'un geste qu'il n'a
 * pas fait.
 */
export function profileLoadErrorMessage(code: string | null | undefined): string {
  return lookup(SHARED_ERRORS, code) ?? LOAD_FALLBACK;
}

const AVATAR_UPLOAD_FALLBACK = "L'avatar n'a pas pu être envoyé. Réessaie dans un instant.";
const AVATAR_DELETE_FALLBACK = "L'avatar n'a pas pu être supprimé. Réessaie dans un instant.";

/**
 * Un téléversement d'avatar refusé.
 *
 * Les refus d'image d'abord — ils nomment ce que le joueur doit changer au
 * fichier, et sont rédigés une fois pour le logo d'équipe et l'avatar —, puis
 * les codes du profil (session, compte supprimé), puis un repli qui nomme le
 * geste.
 */
export function avatarUploadErrorMessage(code: string | null | undefined): string {
  return imageUploadErrorMessage(code) ?? namedMessage(code) ?? AVATAR_UPLOAD_FALLBACK;
}

/** Le retrait de l'avatar refusé : aucun fichier en jeu, seul le repli change. */
export function avatarDeleteErrorMessage(code: string | null | undefined): string {
  return namedMessage(code) ?? AVATAR_DELETE_FALLBACK;
}

/**
 * Une réponse à une invitation d'équipe refusée.
 *
 * Ces refus appartiennent au domaine des **équipes** (invitation retirée,
 * équipe dissoute, joueur déjà membre ailleurs) et ont déjà leur registre : le
 * recopier ici le ferait diverger. On emprunte sa variante « à la deuxième
 * personne » — c'est le joueur lui-même qui répond —, et un code absent ou
 * inconnu (le `TypeError` d'une coupure réseau) y retombe sur le repli de cette
 * route, qui nomme le geste.
 */
export function invitationResponseErrorMessage(code: string | null | undefined): string {
  return membershipErrorMessage(code, "INVITATION_RESPOND_FAILED");
}
