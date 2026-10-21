/**
 * Concatène des classes CSS optionnelles : les absentes (`false`, `undefined`,
 * chaîne vide) sont omises. Logique pure, importable partout.
 */
export function joinClasses(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
