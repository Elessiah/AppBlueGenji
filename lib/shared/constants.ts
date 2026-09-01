import type { TeamRole } from "./types";

export const TEAM_ROLES: TeamRole[] = [
  "COACH",
  "TANK",
  "DPS",
  "HEAL",
  "CAPITAINE",
  "MANAGER",
  "OWNER",
];

export const SCORE_REPORT_TIMEOUT_MINUTES = 10;

/**
 * Effectif minimal pour qu'un tournoi ait un match à jouer.
 *
 * En deçà, le coup d'envoi ne lance rien : le tournoi est clos sur-le-champ et
 * l'unique engagée, s'il y en a une, déclarée première
 * (`docs/features/UNDERFILLED_TOURNAMENTS.md`).
 *
 * Le seuil vit ici, et non chez celui qui l'applique, parce qu'ils sont deux :
 * `finalizeUnderfilledTournament` (`lib/server/tournaments/finalization.ts`)
 * décide de la clôture, et la confirmation du lancement anticipé
 * (`lib/shared/tournament-launch.ts`) l'annonce avant le clic. Écrit deux fois,
 * il se serait tôt ou tard contredit : le dialogue promettant une clôture
 * devant un tournoi qui démarre, ou l'inverse.
 */
export const MIN_ENTRANTS_FOR_MATCHES = 2;
