const ERROR_MESSAGES: Record<string, string> = {
  CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES: "Score verrouillé : la manche suivante a déjà des scores saisis.",
  MATCH_NOT_FOUND: "Match introuvable.",
  MATCH_NOT_READY: "Le match n'a pas deux équipes.",
  MATCH_ALREADY_COMPLETED: "Le match est déjà terminé.",
  DRAW_NOT_ALLOWED: "Les scores ne peuvent pas être égaux.",
  // Formulations de repli : l'interface connaît le format du tournoi et
  // remplace ces messages par une version chiffrée (`matchScoreViolationMessage`).
  SCORE_EXCEEDS_MATCH_FORMAT: "Score impossible pour le format de match du tournoi.",
  SCORE_BELOW_MATCH_FORMAT: "Le vainqueur doit atteindre le nombre de manches du format.",
  INVALID_MATCH_FORMAT: "Format de match invalide.",
  TOURNAMENT_NOT_FOUND: "Tournoi introuvable.",
  TOURNAMENT_NOT_RUNNING: "Le tournoi n'est pas en cours.",
  ADMIN_SAVE_SCORES_FAILED: "Erreur lors de la sauvegarde des scores.",
  ADMIN_RESOLVE_FAILED: "Erreur lors de la résolution du match.",
  INVALID_FORFEIT_TEAM_ID: "ID d'équipe forfait invalide.",
  MISSING_SCORES_OR_FORFEIT: "Scores ou forfait requis.",
  TOURNAMENT_FULL: "Ce tournoi est complet.",
  // Formulation neutre : l'inscrit est une équipe ou un joueur selon le tournoi.
  ALREADY_REGISTERED: "Inscription déjà enregistrée pour ce tournoi.",
  REGISTRATION_CLOSED: "Les inscriptions ne sont pas ouvertes.",
  NO_ACTIVE_TEAM: "Tu dois d'abord créer ou rejoindre une équipe.",
  // Tournoi individuel : le nom d'inscription du joueur est déjà pris.
  SOLO_ENTRY_NAME_UNAVAILABLE:
    "Ton pseudo est déjà utilisé comme nom d'équipe : change-le avant de t'inscrire.",
  USER_NOT_FOUND: "Compte introuvable.",
  NOT_SURVIVAL: "Le forfait n'est disponible que pour les tournois en mode Survie.",
  // Formulations neutres : le forfait peut aussi être déclaré par l'arbitrage
  // pour une autre équipe que la sienne.
  TEAM_ALREADY_OUT: "Cette équipe n'est plus en lice dans ce tournoi.",
  TEAM_NOT_IN_TOURNAMENT: "Cette équipe n'est pas inscrite à ce tournoi.",
  // Volontairement neutre : le même code remonte du forfait, de la diffusion et
  // de toute route protégée. Un message parlant de forfait sur un refus
  // d'antenne enverrait le lecteur chercher un bug là où il n'y en a pas.
  FORBIDDEN: "Tu n'as pas les droits nécessaires pour cette action.",
  FORFEIT_FAILED: "Erreur lors de la déclaration de forfait.",
  // Diffusion en direct (`lib/shared/live-streams.ts`).
  INVALID_STREAM_URL:
    "Lien de diffusion non reconnu (Twitch, YouTube ou Kick attendu).",
  INVALID_LIVE_TRIGGER: "Mode de passage à l'antenne invalide.",
  LIVE_TRIGGER_NOT_MANUAL:
    "Ce match passe à l'antenne automatiquement : il n'y a rien à basculer.",
  MATCH_NOT_LIVE_READY:
    "L'antenne ne s'ouvre que sur un match jouable dont le score n'est pas saisi.",
  MATCH_LIVE_UPDATE_FAILED: "Erreur lors de la mise à jour de la diffusion.",
  TOURNAMENT_LIVE_UPDATE_FAILED: "Erreur lors de la mise à jour de la chaîne officielle.",
};

export function mapError(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] || errorCode;
}
