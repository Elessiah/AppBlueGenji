/**
 * Majuscule initiale d'un fragment écrit pour suivre un tiret (« premier à 3
 * manches gagnées… ») lu seul dans un panneau d'explication. Le reste du texte
 * est laissé tel quel. `locale` : la langue du texte (« i » turc, par exemple).
 */
export function capitalizeFirst(value: string, locale?: string): string {
  if (value === "") return value;
  const first = String.fromCodePoint(value.codePointAt(0)!);
  return first.toLocaleUpperCase(locale) + value.slice(first.length);
}
