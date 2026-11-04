/**
 * Instant (ms) d'une date ISO ; `null` si absente ou illisible.
 *
 * Module sans dépendance, à dessein : `dates.ts` tire `intl-cache`, et les
 * modules de lancement, de salons vocaux et de sections de match sont dans les
 * morceaux client de la page du match.
 */
export function isoTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}
