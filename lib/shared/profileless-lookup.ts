/**
 * Question « ces comptes ont-ils une fiche ? » posée par les liens de joueur
 * (`components/profileless-players.tsx`) à `POST /api/players/profileless`
 * (décision D86) : seuls les comptes **affichés** partent, jamais la liste
 * entière des comptes supprimés sans fiche (D13).
 *
 * Chaque compte part **avec le nom que la page affiche** (`{ id, name }`) : la
 * route ne dit « sans fiche » que d'un compte dont le nom est bien celui
 * d'aujourd'hui (pseudo, ou nom de son entrée solo). Ce nom — pseudo d'emprunt
 * d'un compte supprimé — ne se lit que sur une page qui montre ce joueur : une
 * question sur des identifiants pris au hasard ne reconstitue donc pas la liste
 * des comptes supprimés (revue sécurité EF-65). Le corps d'un `POST`, et non
 * l'adresse, porte ces noms : les journaux d'accès ne gardent pas, par
 * visiteur, les joueurs qui lui ont été montrés.
 */

/** Comptes au plus par question : une page qui en montre davantage pose plusieurs questions. */
export const PROFILELESS_LOOKUP_MAX = 100;

/** Longueur au plus d'un nom envoyé (pseudo ou nom d'entrée solo, largement). */
export const PROFILELESS_NAME_MAX = 100;

/** Noms au plus envoyés pour un même compte (ceux sous lesquels la page le montre). */
export const PROFILELESS_NAMES_PER_ID = 3;

/** Un compte affiché, avec le nom sous lequel la page le montre. */
export type ProfilelessLookupEntry = { id: number; name: string };

/** Le corps d'une question (`POST`), tel que la route le lit. */
export function formatProfilelessLookup(entries: readonly ProfilelessLookupEntry[]): { players: ProfilelessLookupEntry[] } {
  return { players: entries.map(({ id, name }) => ({ id, name })) };
}

/**
 * Les comptes d'une question, sans doublon de couple (un compte montré sous
 * plusieurs noms — pseudo, nom d'entrée solo — part avec chacun, au plus
 * {@link PROFILELESS_NAMES_PER_ID}), dans l'ordre reçu — ou `null` si la question est mal formée :
 * corps sans tableau `players`, liste vide ou de plus de
 * {@link PROFILELESS_LOOKUP_MAX} comptes, identifiant qui n'est pas un entier
 * positif sûr, nom absent, vide ou de plus de {@link PROFILELESS_NAME_MAX}
 * caractères, plus de {@link PROFILELESS_NAMES_PER_ID} noms pour un compte.
 */
export function parseProfilelessLookup(body: unknown): ProfilelessLookupEntry[] | null {
  if (typeof body !== "object" || body === null) return null;
  const players = (body as { players?: unknown }).players;
  if (!Array.isArray(players) || players.length === 0 || players.length > PROFILELESS_LOOKUP_MAX) return null;
  const entries: ProfilelessLookupEntry[] = [];
  const seen = new Set<string>();
  const perId = new Map<number, number>();
  for (const player of players as unknown[]) {
    if (typeof player !== "object" || player === null) return null;
    const { id, name } = player as { id?: unknown; name?: unknown };
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
    if (typeof name !== "string" || name.trim() === "" || name.length > PROFILELESS_NAME_MAX) return null;
    const pair = `${id}:${name}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const count = (perId.get(id) ?? 0) + 1;
    if (count > PROFILELESS_NAMES_PER_ID) return null;
    perId.set(id, count);
    entries.push({ id, name });
  }
  return entries;
}
