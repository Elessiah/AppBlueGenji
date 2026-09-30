/**
 * Planification des matchs par l'arbitrage — option de tournoi
 * (`bg_tournaments.referee_scheduling`).
 *
 * Sans l'option, un match jouable sans horaire entre en **lancement** dès que
 * ses deux engagées sont connues (`lib/shared/match-launch.ts`). Avec elle,
 * chaque match passe d'abord par l'arbitrage :
 *
 *   À planifier → (date posée) → En attente de départ → (heure atteinte) →
 *   Lancement → (« Prêt », forçage ou délai) → Lancé
 *
 * L'état n'est jamais stocké : il se dérive de l'option, de `start_at` et de
 * `launched_at` (`matchLaunchPhase`). Activer l'option en cours de tournoi fait
 * donc passer « à planifier » tout match non lancé et sans date, et les manches
 * suivantes naissent à planifier ; la désactiver les rend au lancement ordinaire.
 *
 * Module pur : le serveur y lit la fenêtre d'écriture de l'option, l'interface
 * les libellés et la liste des matchs qui attendent l'arbitrage.
 *
 * Voir `docs/features/MATCH_PLANNING.md`.
 */
import { matchLaunchPhase, type MatchLaunchPhase } from "./match-launch";
import type { BracketMatch, TournamentState } from "./types";

/**
 * L'option se règle à la création, et **se modifie à tout moment avant la
 * clôture** — tournoi en cours compris : c'est une règle d'organisation, qui
 * ne touche ni aux appariements ni aux scores. Sur un tournoi terminé, elle
 * ne décrirait plus rien.
 */
export function canToggleRefereeScheduling(state: TournamentState): boolean {
  return state !== "FINISHED";
}

/** Libellé d'une phase de lancement, pour la carte de match et l'arbitrage. */
export const LAUNCH_PHASE_LABELS: Readonly<Record<MatchLaunchPhase, string | null>> = {
  NONE: null,
  TO_PLAN: "À planifier",
  SCHEDULED: "En attente de départ",
  LOBBY: "Lancement",
  LAUNCHED: "Lancé",
};

/** Ce que la liste des matchs à planifier lit d'un match du plateau. */
type PlanningMatch = Pick<
  BracketMatch,
  "id" | "status" | "team1Id" | "team2Id" | "startAt" | "launchedAt"
>;

/**
 * Matchs du plateau qui attendent une date de l'arbitrage, dans l'ordre du
 * plateau. Vide quand l'option est éteinte : sans elle, aucun match n'est à
 * planifier — l'horloge ne joue aucun rôle dans la réponse, `TO_PLAN` ne
 * dépendant pas de l'instant.
 */
export function matchesToPlan<T extends PlanningMatch>(
  matches: readonly T[],
  refereeScheduling: boolean,
): T[] {
  if (!refereeScheduling) return [];
  return matches.filter(
    (match) =>
      matchLaunchPhase(
        {
          status: match.status,
          team1Id: match.team1Id,
          team2Id: match.team2Id,
          startAt: match.startAt,
          launchedAt: match.launchedAt,
          refereeScheduling: true,
        },
        0,
      ) === "TO_PLAN",
  );
}

/**
 * Pourquoi un engagé ne peut pas encore saisir de score, selon la phase : la
 * modale joueur disait toujours « toutes les parties doivent se déclarer
 * prêtes », faux tant que le match attend l'arbitrage ou son heure.
 */
export function playerScoreClosedNotice(phase: MatchLaunchPhase, startAtFull: string | null): string {
  if (phase === "TO_PLAN") {
    return "Ce match attend que l'arbitrage fixe sa date : le score se saisira une fois le match lancé.";
  }
  if (phase === "SCHEDULED") {
    return startAtFull
      ? `Ce match démarre le ${startAtFull} : le score se saisit une fois lancé, quand les parties se sont déclarées prêtes.`
      : "Ce match n'a pas encore démarré : le score se saisit une fois lancé, quand les parties se sont déclarées prêtes.";
  }
  return "Le score se saisit une fois le match lancé : toutes les parties doivent s'être déclarées prêtes.";
}

/** « 3 matchs à planifier » — accord du nom sur le nombre. */
export function toPlanCountLabel(count: number): string {
  return count === 1 ? "1 match à planifier" : `${count} matchs à planifier`;
}

/** Confirmation affichée après une bascule réussie. */
export function refereeSchedulingToggledMessage(enabled: boolean, movedToPlanning: number): string {
  if (!enabled) {
    return "Planification par l'arbitrage désactivée : les matchs sans date entrent en lancement.";
  }
  return movedToPlanning > 0
    ? `Planification activée : ${toPlanCountLabel(movedToPlanning)}.`
    : "Planification par l'arbitrage activée.";
}

/**
 * Ce que la confirmation d'allumage annonce, accordé au nombre de matchs
 * réellement renvoyés à planifier.
 */
export function enablePlanningConsequence(moving: number): string {
  return moving === 1
    ? "1 match, sans date et pas encore lancé, quitte le lancement — ses « Prêt » sont effacés — et attend qu'un arbitre fixe son horaire."
    : `${moving} matchs, sans date et pas encore lancés, quittent le lancement — leurs « Prêt » sont effacés — et attendent qu'un arbitre fixe leur horaire.`;
}

/** Libellé de l'interrupteur : l'action qu'il déclenche. */
export function refereeSchedulingToggleLabel(enabled: boolean): string {
  return enabled ? "Désactiver la planification" : "Activer la planification";
}

/** Codes de refus de la bascule de l'option. */
export const REFEREE_SCHEDULING_ERRORS: Readonly<Record<string, string>> = {
  TOURNAMENT_NOT_FOUND: "Tournoi introuvable.",
  TOURNAMENT_FINISHED: "Le tournoi est terminé : l'option ne peut plus être modifiée.",
  INVALID_REFEREE_SCHEDULING: "Valeur invalide pour la planification par l'arbitrage.",
};

export function refereeSchedulingErrorMessage(code: string | null | undefined): string {
  // `Object.hasOwn` et non un simple accès : `REFEREE_SCHEDULING_ERRORS["constructor"]`
  // remonterait la chaîne de prototypes et rendrait une fonction.
  if (code && Object.hasOwn(REFEREE_SCHEDULING_ERRORS, code)) return REFEREE_SCHEDULING_ERRORS[code];
  return "La planification n'a pas pu être modifiée. Réessaie dans un instant.";
}

/**
 * Phrase qui décrit l'option, partagée par le formulaire de création et la
 * fiche : ce qu'elle promet aux engagés ne doit être rédigé qu'une fois.
 */
export const REFEREE_SCHEDULING_DESCRIPTION =
  "Chaque match attend qu'un arbitre ou un admin fixe sa date et son heure (« À planifier »), puis « En attente de départ » jusqu'à l'heure dite, où il entre en lancement.";
