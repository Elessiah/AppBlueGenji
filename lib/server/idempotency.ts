/**
 * Rejeu sans double effet d'un envoi répété (`docs/features/BUSY_BUTTONS.md`,
 * § « Côté serveur »).
 *
 * La garde des boutons (`useBusyGuard`) ne vaut que pour **un** écran : un
 * envoi parti, dont la réponse se perd (réseau coupé après l'écriture, corps
 * illisible d'un relais, navigation qui n'aboutit pas), laisse l'utilisateur
 * renvoyer le même geste — et le serveur l'aurait exécuté deux fois (deux
 * tournois identiques, une pénalité comptée double).
 *
 * Le client joint donc à ces envois une **clé de requête** tirée une fois par
 * geste (`newRequestKey`, `lib/shared/request-key.ts`) ; la route exécute la
 * tâche une seule fois par clé et rend aux répétitions **le même résultat**.
 * Une répétition arrivée pendant la première exécution attend sa fin au lieu
 * d'en lancer une seconde. Un échec n'est pas retenu : le geste peut être
 * retenté avec la même clé.
 *
 * Mémoire d'un seul processus (le site tourne en un seul processus pm2, comme
 * les seaux de `rate-limit.ts`) : un redémarrage l'efface, ce qui ne rouvre
 * qu'une fenêtre de quelques secondes. Bornée en durée et en nombre d'entrées.
 * La clé est rangée sous une portée qui nomme la route, l'utilisateur et la
 * cible : la clé d'un autre compte ne rend jamais son résultat.
 */

/** Durée pendant laquelle une répétition rend le résultat de la première. */
export const IDEMPOTENCY_TTL_MS = 10 * 60_000;
/** Plafond d'entrées gardées : au-delà, les plus anciennes partent. */
export const IDEMPOTENCY_MAX_ENTRIES = 2_000;

/** Forme d'une clé acceptée : celle de `crypto.randomUUID()` ou du repli. */
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

type Entry = { expiresAt: number; result: Promise<unknown> };

const entries = new Map<string, Entry>();

/** La clé de requête d'un corps reçu, ou `null` (absente ou mal formée : pas de rejeu). */
export function readRequestKey(value: unknown): string | null {
  return typeof value === "string" && REQUEST_KEY_PATTERN.test(value) ? value : null;
}

function prune(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  // `Map` garde l'ordre d'insertion : les premières sont les plus anciennes.
  while (entries.size >= IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/**
 * Exécute `task` une fois par `(scope, key)` : une répétition rend le résultat
 * (ou attend l'exécution en cours) de la première. Sans clé, `task` s'exécute
 * simplement.
 */
export function runOnce<T>(
  scope: string,
  key: string | null,
  task: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  if (key === null) return task();
  const id = `${scope}\u0000${key}`;
  const existing = entries.get(id);
  if (existing && existing.expiresAt > now) return existing.result as Promise<T>;
  prune(now);
  const result = task();
  const entry: Entry = { expiresAt: now + IDEMPOTENCY_TTL_MS, result };
  entries.set(id, entry);
  // Un échec n'est pas retenu : la même clé peut retenter.
  result.catch(() => {
    if (entries.get(id) === entry) entries.delete(id);
  });
  return result;
}

/** Tests seulement : vide la mémoire des rejeux. */
export function resetIdempotencyForTests(): void {
  entries.clear();
}
