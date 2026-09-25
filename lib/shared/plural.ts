/** Accord au pluriel en français régulier (ajout d'un « s »), sauf forme irrégulière fournie. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
