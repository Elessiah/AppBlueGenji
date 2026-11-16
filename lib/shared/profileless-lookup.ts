/**
 * Question « ces comptes ont-ils une fiche ? » posée par les liens de joueur
 * (`components/profileless-players.tsx`) à `/api/players/profileless`
 * (décision D86) : seuls les identifiants **affichés** partent, jamais la liste
 * entière des comptes supprimés sans fiche (D13).
 */

/** Identifiants au plus par question : une page qui en montre davantage pose plusieurs questions. */
export const PROFILELESS_LOOKUP_MAX = 100;

/** Les identifiants d'une question, tels que la requête les porte (`?ids=3,8`). */
export function formatProfilelessLookup(ids: readonly number[]): string {
  return ids.join(",");
}

/**
 * Les identifiants d'une question (`?ids=3,8`), sans doublon, dans l'ordre
 * reçu — ou `null` si la question est mal formée : paramètre absent ou vide,
 * élément qui n'est pas un entier positif, plus de {@link PROFILELESS_LOOKUP_MAX}
 * identifiants.
 */
export function parseProfilelessLookup(raw: string | null): number[] | null {
  if (raw === null || raw === "") return null;
  const parts = raw.split(",");
  if (parts.length > PROFILELESS_LOOKUP_MAX) return null;
  const ids: number[] = [];
  for (const part of parts) {
    if (!/^[1-9]\d{0,15}$/.test(part)) return null;
    const id = Number(part);
    if (!Number.isSafeInteger(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
