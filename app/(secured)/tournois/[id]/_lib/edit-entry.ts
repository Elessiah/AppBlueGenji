import { formatLocalDateTime } from "@/lib/shared/dates";
import {
  editWindowFor,
  type EditLockReason,
} from "@/lib/shared/tournament-edit";
import {
  canToggleRefereeScheduling,
  refereeSchedulingToggledMessage,
} from "@/lib/shared/match-planning";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Le bouton « Modifier » n'est affiché que s'il mène quelque part : au staff
 * `tournaments`, sur un tournoi que la fenêtre laisse encore ouvrir **ou** dont
 * la planification des matchs par l'arbitrage reste réglable — c'est-à-dire
 * jusqu'à la clôture, tournoi en cours compris. Pas de bouton grisé : un
 * tournoi terminé n'en montre aucun.
 */
export function canShowEditButton(
  card: TournamentCard,
  hasTournamentPermission: boolean,
  now: number = Date.now(),
): boolean {
  if (!hasTournamentPermission) return false;
  return editWindowFor(card, now) !== "LOCKED" || canToggleRefereeScheduling(card.state);
}

/** Un tournoi terminé : plus rien ne se règle, planification comprise. */
export const FINISHED_EDIT_NOTICE = "Le tournoi est terminé : il n'est plus modifiable.";

/**
 * Phrase affichée **une fois** en tête du formulaire, plutôt que répétée sur
 * chaque champ désactivé.
 */
export function editLockNotice(
  reason: EditLockReason,
  startVisibilityAt: string,
): string | null {
  if (reason === null) return null;
  if (reason === "STARTED") {
    return "Le tournoi est en cours : seule la planification des matchs par l'arbitrage reste modifiable.";
  }
  return `Le tournoi est visible depuis le ${formatLocalDateTime(startVisibilityAt)} — le format, le jeu et les réglages ne sont plus modifiables.`;
}

/** Ce que l'enregistrement de la planification a produit, tel que la route le rend. */
export type PlanningSaveResult = { changed: boolean; movedToPlanning: number };

/**
 * Confirmation après « Enregistrer les modifications ». Elle ne dit « modifié »
 * que si quelque chose l'a été : sur un tournoi lancé, le formulaire n'envoie
 * que la planification, et la renvoyer inchangée n'écrit rien.
 *
 * @param fieldsSent  des champs de la fenêtre d'édition sont partis ;
 * @param planning    résultat de la bascule, `null` si elle n'a pas été envoyée.
 */
export function editSavedMessage(
  fieldsSent: boolean,
  planning: PlanningSaveResult | null,
  planningEnabled: boolean,
): string {
  const planningChanged = planning?.changed === true;
  if (!fieldsSent && !planningChanged) return "Aucune modification à enregistrer.";
  if (!planningChanged) return "Tournoi modifié.";
  const toggled = refereeSchedulingToggledMessage(planningEnabled, planning.movedToPlanning);
  return fieldsSent ? `Tournoi modifié. ${toggled}` : toggled;
}
