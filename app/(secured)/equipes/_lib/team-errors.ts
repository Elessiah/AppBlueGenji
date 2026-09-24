/**
 * Les refus des routes d'équipe, dits en français.
 *
 * Né pour les seuls gestes d'appartenance (rejoindre, quitter, répondre à une
 * demande), qui remontaient le code brut du serveur dans le toast — un joueur
 * lisait `USER_ALREADY_IN_TEAM` en capitales. La **gestion** de l'équipe avait
 * gardé le défaut : exclure, inviter, changer les rôles, renommer, changer le
 * logo, transférer, attribuer ou dissoudre affichaient toujours le jeton
 * (`ALREADY_INVITED`, `CANNOT_KICK_OWNER`, `MISSING_ROLE`, `FORBIDDEN`…). Tout
 * passe désormais par ce registre : une seule page, un seul vocabulaire.
 *
 * Ce n'est pas un détail de forme — le projet pose que **tout le texte
 * d'interface est en français**, et un code d'erreur ne dit pas au joueur ce
 * qu'il doit faire.
 *
 * Même forme que `app/(secured)/tournois/[id]/_lib/error-map.ts` : un registre
 * pur, et un repli qui n'invente rien quand le code est inconnu.
 */

import { imageUploadErrorMessage } from "@/lib/shared/image-upload-errors";
import { teamTagErrorMessage } from "@/lib/shared/team-tag";
import { TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH } from "@/lib/shared/team-name";

const TEAM_ERRORS: Record<string, string> = {
  // Le refus le plus banal de toutes les routes, et le seul que le joueur puisse
  // corriger tout seul : la session dure trente jours, elle finit par tomber —
  // ou l'onglet voisin s'est déconnecté. Sans cette ligne, un clic sur « Quitter
  // l'équipe » ne disait plus que « L'opération a échoué », sans jamais nommer
  // la seule chose à faire.
  UNAUTHORIZED: "Ta session a expiré : reconnecte-toi pour continuer.",
  // Posé par le client (`team-api.ts`) quand la requête n'a pas abouti du tout.
  NETWORK_ERROR: "Connexion impossible. Vérifie ton réseau puis réessaie.",
  // Identifiant hors d'un entier positif : l'URL a été bricolée, ou un lien est
  // périmé. Rien à corriger dans le formulaire.
  INVALID_TEAM_ID: "Cette équipe n'existe pas.",
  INVALID_INVITATION_ID: "Cette invitation n'existe pas.",
  // La ligne existe dans `bg_teams`, mais elle ne représente pas une équipe
  // qu'on rejoint : une fantôme n'a aucun membre — elle s'attribue par
  // l'arbitrage —, et une entrée solo est l'identité d'un joueur en tournoi
  // individuel. Dans les deux cas la demande n'aurait jamais trouvé personne
  // pour y répondre.
  TEAM_NOT_JOINABLE: "Cette fiche n'est pas une équipe que l'on peut rejoindre.",
  TEAM_NOT_FOUND: "Cette équipe n'existe pas ou n'existe plus.",
  TEAM_DELETED: "Cette équipe a été dissoute.",
  TEAM_ALREADY_DELETED: "Cette équipe a déjà été dissoute.",
  USER_ALREADY_IN_TEAM: "Ce joueur appartient déjà à une équipe : il doit la quitter d'abord.",
  ALREADY_REQUESTED: "Ta demande est déjà en attente auprès de cette équipe.",
  NOT_A_MEMBER: "Tu ne fais pas partie de cette équipe.",
  // Le propriétaire ne peut pas se retirer : l'équipe se retrouverait sans
  // personne pour la conduire. Le transfert de propriété est le geste attendu.
  OWNER_MUST_TRANSFER:
    "Transfère d'abord la propriété de l'équipe à un autre membre, puis quitte-la.",
  FORBIDDEN: "Tu n'as pas les droits nécessaires sur cette équipe.",
  INVITATION_NOT_FOUND: "Cette invitation n'existe plus.",
  INVITATION_NOT_PENDING: "Cette invitation a déjà reçu une réponse.",

  // ── Gestion du roster ──
  MISSING_PSEUDO: "Saisis le pseudo du joueur.",
  INVALID_PSEUDO: "Saisis le pseudo du joueur.",
  USER_NOT_FOUND: "Aucun joueur ne porte ce pseudo. Vérifie l'orthographe.",
  ALREADY_INVITED: "Ce joueur a déjà une invitation en attente de ton équipe.",
  MISSING_USER_ID: "Ce membre est introuvable. Recharge la page.",
  MEMBER_NOT_FOUND: "Ce joueur ne fait plus partie de l'équipe.",
  MISSING_ROLE: "Choisis au moins un rôle.",
  CANNOT_KICK_OWNER: "Le propriétaire ne peut pas être exclu de son équipe.",
  // `removeTeamMember` refuse de s'exclure soi-même sous ce nom, quel que soit
  // le rôle : le code dit « propriétaire », le geste attendu est de quitter.
  OWNER_CANNOT_LEAVE: "Tu ne peux pas t'exclure toi-même : utilise « Quitter l'équipe ».",

  // ── Identité de l'équipe ──
  INVALID_TEAM_NAME: `Le nom de l'équipe doit compter de ${TEAM_NAME_MIN_LENGTH} à ${TEAM_NAME_MAX_LENGTH} caractères.`,
  TEAM_NAME_ALREADY_USED: "Ce nom est déjà porté par une autre équipe.",
  INVALID_TEAM_FIELDS: "Les informations de l'équipe envoyées sont invalides. Recharge la page puis réessaie.",
  TRANSFER_TO_SELF: "Tu es déjà propriétaire de cette équipe.",
  PLAYER_ACCOUNT_DELETED: "Ce joueur a supprimé son compte : il ne peut plus rejoindre d'équipe.",
  MEMBER_ACCOUNT_DELETED: "Ce compte a été supprimé : il ne peut pas recevoir la propriété de l'équipe.",
  NOT_A_GHOST_TEAM: "Cette équipe n'est plus une équipe fantôme : elle a déjà un propriétaire.",

  // ── Replis des routes : chacun nomme le geste qui a échoué. ──
  TEAM_JOIN_FAILED: "La demande n'a pas pu être envoyée.",
  TEAM_LEAVE_FAILED: "Le départ n'a pas pu être enregistré.",
  // Le repli de la troisième route, oublié quand ses deux sœurs y figuraient.
  INVITATION_RESPOND_FAILED: "La réponse à l'invitation n'a pas pu être enregistrée.",
  INVITATION_CANCEL_FAILED: "L'invitation n'a pas pu être retirée.",
  INVITATIONS_LOAD_FAILED: "Les invitations en attente n'ont pas pu être chargées.",
  TEAM_MEMBER_ADD_FAILED: "L'invitation n'a pas pu être envoyée.",
  TEAM_INVITE_FAILED: "L'invitation n'a pas pu être envoyée.",
  TEAM_MEMBER_REMOVE_FAILED: "Le membre n'a pas pu être exclu.",
  TEAM_MEMBER_UPDATE_FAILED: "Les rôles n'ont pas pu être enregistrés.",
  TEAM_UPDATE_FAILED: "Les modifications de l'équipe n'ont pas pu être enregistrées.",
  TEAM_CREATE_FAILED: "L'équipe n'a pas pu être créée.",
  GHOST_TEAM_CREATE_FAILED: "L'équipe fantôme n'a pas pu être créée.",
  TEAMS_LOAD_FAILED: "La liste des équipes n'a pas pu être chargée.",
  TEAM_DELETE_FAILED: "L'équipe n'a pas pu être dissoute.",
  TEAM_CLAIM_FAILED: "L'équipe n'a pas pu être attribuée.",
  TEAM_OWNERSHIP_TRANSFER_FAILED: "La propriété n'a pas pu être transférée.",
  LOGO_UPLOAD_FAILED: "Le logo n'a pas pu être envoyé.",
  LOGO_DELETE_FAILED: "Le logo n'a pas pu être supprimé.",
  // Conditions d'utilisation : non acceptées par qui gère l'équipe (la modale
  // s'ouvre en même temps, `teamApi`), ou case décochée à la création.
  TERMS_ACCEPTANCE_REQUIRED:
    "Pour gérer ton équipe, accepte d'abord les conditions d'utilisation (fenêtre ouverte à l'instant).",
  TERMS_REQUIRED: "Coche l'acceptation des conditions d'utilisation pour créer ton équipe.",
  LOGO_RIGHTS_NOT_CERTIFIED: "Certifie détenir les droits sur ce logo pour l'envoyer.",
  TEAM_HAS_NO_LOGO: "Cette équipe n'a déjà plus de logo.",
  TEAM_LOGO_REMOVE_FAILED: "Le logo n'a pas pu être retiré.",
};

const FALLBACK = "L'opération a échoué.";

/**
 * Message à afficher pour un code de refus.
 *
 * Les refus de forme du sigle ont leur propre registre (`teamTagErrorMessage`,
 * partagé avec la création), ceux d'une image aussi (`imageUploadErrorMessage`,
 * partagé avec l'avatar) : ils sont consultés d'abord. Un code inconnu retombe
 * sur une phrase générique **et non sur le code lui-même** : le jour où le
 * serveur en ajoute un, le joueur lit une phrase, pas un jeton.
 *
 * `fallbackCode` nomme le repli du geste (`INVITATION_RESPOND_FAILED`…) : il
 * sert au code absent **et** au code inconnu — le `TypeError` d'une coupure
 * réseau arrive dans le même `catch` que les refus du serveur, et « L'opération
 * a échoué » ne dirait pas laquelle.
 */
export function teamErrorMessage(
  code: string | null | undefined,
  fallbackCode?: string,
): string {
  const fallback = () =>
    fallbackCode && Object.prototype.hasOwnProperty.call(TEAM_ERRORS, fallbackCode)
      ? TEAM_ERRORS[fallbackCode]
      : FALLBACK;
  if (!code) return fallback();
  const tagMessage = teamTagErrorMessage(code);
  if (tagMessage) return tagMessage;
  // Les refus du logo sont ceux de toute image téléversée : une seule rédaction,
  // partagée avec l'avatar de `/profil`.
  const imageMessage = imageUploadErrorMessage(code);
  if (imageMessage) return imageMessage;
  // `code in` remonterait la chaîne de prototypes (« constructor »).
  return Object.prototype.hasOwnProperty.call(TEAM_ERRORS, code) ? TEAM_ERRORS[code] : fallback();
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
): string {
  if (code === "USER_ALREADY_IN_TEAM") return "Tu appartiens déjà à une équipe : quitte-la d'abord.";
  return teamErrorMessage(code, fallbackCode);
}
