/**
 * Les refus d'adhésion, dits en français.
 *
 * Les gestes d'appartenance à une équipe (rejoindre, quitter, répondre à une
 * demande) remontaient le code brut du serveur dans le toast : un joueur lisait
 * `USER_ALREADY_IN_TEAM` en capitales. Ce n'est pas un détail de forme — le
 * projet pose que **tout le texte d'interface est en français**, et un code
 * d'erreur ne dit pas au joueur ce qu'il doit faire.
 *
 * Même forme que `app/(secured)/tournois/[id]/_lib/error-map.ts` : un registre
 * pur, et un repli qui n'invente rien quand le code est inconnu.
 */

const MEMBERSHIP_ERRORS: Record<string, string> = {
  // Le refus le plus banal des trois routes, et le seul que le joueur puisse
  // corriger tout seul : la session dure trente jours, elle finit par tomber —
  // ou l'onglet voisin s'est déconnecté. Sans cette ligne, un clic sur « Quitter
  // l'équipe » ne disait plus que « L'opération a échoué », sans jamais nommer
  // la seule chose à faire.
  UNAUTHORIZED: "Ta session a expiré : reconnecte-toi pour continuer.",
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
  USER_ALREADY_IN_TEAM: "Tu appartiens déjà à une équipe : quitte-la d'abord.",
  ALREADY_REQUESTED: "Ta demande est déjà en attente auprès de cette équipe.",
  NOT_A_MEMBER: "Tu ne fais pas partie de cette équipe.",
  // Le propriétaire ne peut pas se retirer : l'équipe se retrouverait sans
  // personne pour la conduire. Le transfert de propriété est le geste attendu.
  OWNER_MUST_TRANSFER:
    "Transfère d'abord la propriété de l'équipe à un autre membre, puis quitte-la.",
  FORBIDDEN: "Tu n'as pas les droits nécessaires sur cette équipe.",
  INVITATION_NOT_FOUND: "Cette invitation n'existe plus.",
  INVITATION_NOT_PENDING: "Cette invitation a déjà reçu une réponse.",
  TEAM_JOIN_FAILED: "La demande n'a pas pu être envoyée.",
  TEAM_LEAVE_FAILED: "Le départ n'a pas pu être enregistré.",
  // Le repli de la troisième route, oublié quand ses deux sœurs y figuraient.
  INVITATION_RESPOND_FAILED: "La réponse à l'invitation n'a pas pu être enregistrée.",
};

/**
 * Message à afficher pour un code de refus.
 *
 * Un code inconnu retombe sur une phrase générique **et non sur le code
 * lui-même** : le jour où le serveur en ajoute un, le joueur lit une phrase, pas
 * un jeton.
 */
export function membershipErrorMessage(code: string | null | undefined): string {
  if (!code) return "L'opération a échoué.";
  return MEMBERSHIP_ERRORS[code] ?? "L'opération a échoué.";
}
