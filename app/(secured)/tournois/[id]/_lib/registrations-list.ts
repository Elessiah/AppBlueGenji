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
