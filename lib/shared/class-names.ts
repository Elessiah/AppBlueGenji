/**
 * Concatène des classes CSS optionnelles : les absentes (`false`, `undefined`,
 * chaîne vide) sont omises. Logique pure, importable partout.
 */
export function joinClasses(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/**
 * Classe de troncature d'un nom d'entité (`truncate` des liens d'entité et
 * d'`EntrantName`) : `true` sur une ligne, `2` à deux lignes (`app/globals.css`).
 */
export function entityTruncateClass(truncate: boolean | 2): string | false {
  if (truncate === 2) return "entity-clamp-2";
  return truncate && "entity-truncate";
}
