const ERROR_MESSAGES: Record<string, string> = {
  CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES: "Impossible de modifier ce match car les matchs suivants sont déjà terminés.",
  MATCH_NOT_FOUND: "Match introuvable.",
  MATCH_NOT_READY: "Le match n'a pas deux équipes.",
  MATCH_ALREADY_COMPLETED: "Le match est déjà terminé.",
  DRAW_NOT_ALLOWED: "Les scores ne peuvent pas être égaux.",
  TOURNAMENT_NOT_FOUND: "Tournoi introuvable.",
  TOURNAMENT_NOT_RUNNING: "Le tournoi n'est pas en cours.",
  ADMIN_SAVE_SCORES_FAILED: "Erreur lors de la sauvegarde des scores.",
  ADMIN_RESOLVE_FAILED: "Erreur lors de la résolution du match.",
  INVALID_FORFEIT_TEAM_ID: "ID d'équipe forfait invalide.",
  MISSING_SCORES_OR_FORFEIT: "Scores ou forfait requis.",
  TOURNAMENT_FULL: "Ce tournoi est complet.",
  TEAM_ALREADY_REGISTERED: "Ton équipe est déjà inscrite.",
  REGISTRATION_CLOSED: "Les inscriptions ne sont pas ouvertes.",
  NO_ACTIVE_TEAM: "Tu dois d'abord créer ou rejoindre une équipe.",
};

export function mapError(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] || errorCode;
}
