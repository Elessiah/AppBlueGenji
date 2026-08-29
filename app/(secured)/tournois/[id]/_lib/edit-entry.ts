import { formatLocalDateTime } from "@/lib/shared/dates";
import {
  editWindowFor,
  type EditLockReason,
} from "@/lib/shared/tournament-edit";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Le bouton « Modifier » n'est affiché que s'il mène quelque part : au staff
 * `tournaments`, et sur un tournoi que la fenêtre laisse encore ouvrir. Pas de
 * bouton grisé — un tournoi en cours n'en montre aucun.
 */
export function canShowEditButton(
  card: TournamentCard,
  hasTournamentPermission: boolean,
  now: number = Date.now(),
): boolean {
  if (!hasTournamentPermission) return false;
  return editWindowFor(card, now) !== "LOCKED";
}

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
    return "Le tournoi est en cours : il n'est plus modifiable.";
  }
  return `Le tournoi est visible depuis le ${formatLocalDateTime(startVisibilityAt)} — le format, le jeu et les réglages ne sont plus modifiables.`;
}
