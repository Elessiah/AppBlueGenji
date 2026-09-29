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
 * Tournois terminés portés par la liste publique mutualisée : les plus
 * récents seulement, autant que la section « Terminés » de `/tournois` en
 * montre repliée.
 *
 * La liste chargeait **tous** les tournois terminés depuis l'origine, résumés
 * compris (championne, déroulement), pour l'accueil comme pour `/tournois`,
 * qui n'en affiche que douze — un coût qui grandissait avec l'historique. Le
 * reste s'obtient à la demande (`GET /api/tournaments?finished=all`), quand le
 * lecteur déplie la section ou cherche dans l'archive.
 */
export const FINISHED_TOURNAMENTS_LIST_LIMIT = 12;

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
