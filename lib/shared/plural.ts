/**
 * Accords au pluriel **en français**, pour les écrans pas encore traduits.
 *
 * Un écran traduit n'emploie plus ces fonctions : son pluriel est un message
 * ICU (`{count, plural, one {# équipe} other {# équipes}}`), dont la langue
 * choisit la branche — le français range 0 et 1 au singulier, l'anglais 1
 * seulement (`docs/features/I18N.md` § Dates, nombres, pluriels). Ces deux
 * fonctions s'éteindront avec le dernier écran qui les appelle.
 */

/** Accord au pluriel en français régulier (ajout d'un « s »), sauf forme irrégulière fournie. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Marque du pluriel seule (« s » par défaut), vide au singulier — pour un mot déjà écrit. */
export function pluralSuffix(count: number, suffix = "s"): string {
  return count > 1 ? suffix : "";
}
