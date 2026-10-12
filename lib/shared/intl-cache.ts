/**
 * Une instance par langue : les formateurs `Intl` sont coûteuses à construire
 * et lus à chaque rendu — `message-format.ts`, `dates.ts`, `ordinal.ts`.
 *
 * Module à part (lot 9-1, revue performance) : `dates.ts`, importé par de
 * nombreux écrans, n'embarque pas l'analyseur de messages pour ces six lignes.
 */
export function cached<K, T>(cache: Map<K, T>, locale: K, create: (locale: K) => T): T {
  let value = cache.get(locale);
  if (value === undefined) {
    value = create(locale);
    cache.set(locale, value);
  }
  return value;
}
