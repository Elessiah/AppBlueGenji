/** Accord au pluriel en français régulier (ajout d'un « s »), sauf forme irrégulière fournie. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Marque du pluriel seule (« s » par défaut), vide au singulier — pour un mot déjà écrit. */
export function pluralSuffix(count: number, suffix = "s"): string {
  return count > 1 ? suffix : "";
}
