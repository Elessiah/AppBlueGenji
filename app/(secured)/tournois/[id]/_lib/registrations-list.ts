import type { SeedingLockReason } from "@/lib/shared/seeding";
import type { EntrantRemovalBlockReason } from "@/lib/shared/entrant-removal";

/**
 * Repli de la liste des inscrites (`RegistrationsPanel`).
 *
 * Un tournoi à 128 engagées rendait 128 lignes d'environ 100 px sur téléphone :
 * une fiche de 16 000 px, où tout ce qui suit la liste (plateau, frise) devenait
 * introuvable. La liste montre donc les `REGISTRATIONS_DISPLAY_LIMIT` premières
 * lignes et un bouton réversible pour le reste.
 *
 * `expanded` est un drapeau, pas un compte figé (même règle que les sections de
 * `/tournois`) : une liste dépliée le reste quand le flux y ajoute une ligne.
 */
export const REGISTRATIONS_DISPLAY_LIMIT = 16;

/** Nombre de lignes à rendre. */
export function visibleRegistrationCount(
  total: number,
  expanded: boolean,
  limit: number = REGISTRATIONS_DISPLAY_LIMIT,
): number {
  if (expanded || total <= limit) return total;
  return Math.max(0, limit);
}

/** Nombre de lignes masquées tant que la liste est repliée (0 : pas de bouton). */
export function hiddenRegistrationCount(
  total: number,
  limit: number = REGISTRATIONS_DISPLAY_LIMIT,
): number {
  return Math.max(0, total - limit);
}

/**
 * Faut-il déplier la liste pour suivre une ligne qu'on vient de déplacer ?
 * Une flèche « descendre » sur la dernière ligne visible l'enverrait sinon hors
 * de vue, et le focus rendu au bouton de la ligne n'aurait plus de cible.
 */
export function mustExpandToShow(
  index: number,
  expanded: boolean,
  limit: number = REGISTRATIONS_DISPLAY_LIMIT,
): boolean {
  return !expanded && index >= limit;
}

/**
 * Phrase du retrait à afficher, ou `null`. Sur un tournoi terminé, « l'ordre
 * n'a plus d'effet » et « la liste est un palmarès » disent le même fait ; sur
 * un tournoi lancé, « l'ordre est figé » et « le tirage est fait » aussi : le
 * verrou de l'ordre garde alors seul la parole.
 */
export function removalNotice(
  removalBlock: EntrantRemovalBlockReason | null,
  lockReason: SeedingLockReason,
): EntrantRemovalBlockReason | null {
  if (removalBlock === null) return null;
  if (lockReason === "FINISHED" && removalBlock === "ENTRANT_REMOVAL_TOURNAMENT_FINISHED") return null;
  if (lockReason === "STARTED" && removalBlock === "ENTRANT_REMOVAL_TOURNAMENT_STARTED") return null;
  return removalBlock;
}

/**
 * Colonne d'actions de la liste : gabarit de grille (cellule d'actions dès
 * qu'une commande est là) et intitulé qui nomme ce qu'elle contient réellement.
 */
export function registrationActionsColumn(
  reorderable: boolean,
  removable: boolean,
): { grid: "withActions" | null; label: "Actions" | "Ordre" | "Retrait" } {
  if (reorderable) return { grid: "withActions", label: removable ? "Actions" : "Ordre" };
  return { grid: removable ? "withActions" : null, label: "Retrait" };
}
