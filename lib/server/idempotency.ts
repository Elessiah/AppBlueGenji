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
/** Plafond d'entrées gardées : au-delà, les plus anciennes **terminées** partent. */
export const IDEMPOTENCY_MAX_ENTRIES = 2_000;
/**
 * Plafond d'entrées gardées par portée (route + utilisateur + cible) : un
 * compte qui enverrait des clés neuves en rafale n'use que sa propre part, il
 * ne fait pas partir celles des autres.
 */
export const IDEMPOTENCY_MAX_PER_SCOPE = 100;

/** Forme d'une clé acceptée : celle de `crypto.randomUUID()` ou du repli. */
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

type Entry = {
  scope: string;
  expiresAt: number;
  result: Promise<unknown>;
  /** Corps du premier envoi (hors clé), `null` si l'appelant n'en donne pas. */
  fingerprint: string | null;
  /** Une tâche encore en cours n'est jamais retirée : sa répétition l'attend. */
  settled: boolean;
};

const entries = new Map<string, Entry>();

/** La clé de requête d'un corps reçu, ou `null` (absente ou mal formée : pas de rejeu). */
export function readRequestKey(value: unknown): string | null {
  return typeof value === "string" && REQUEST_KEY_PATTERN.test(value) ? value : null;
}

/** Fait de la place : retire les entrées échues, puis les plus anciennes **terminées** de la portée et du total ; faux si tout est en cours. */
function prune(now: number, scope: string): boolean {
  let inScope = 0;
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now && entry.settled) entries.delete(key);
    else if (entry.scope === scope) inScope += 1;
  }
  const evictOldestSettled = (match: (entry: Entry) => boolean): boolean => {
    // `Map` garde l'ordre d'insertion : les premières sont les plus anciennes.
    for (const [key, entry] of entries) {
      if (entry.settled && match(entry)) {
        entries.delete(key);
        return true;
      }
    }
    return false;
  };
  while (inScope >= IDEMPOTENCY_MAX_PER_SCOPE) {
    if (!evictOldestSettled((entry) => entry.scope === scope)) return false;
    inScope -= 1;
  }
  while (entries.size >= IDEMPOTENCY_MAX_ENTRIES) {
    if (!evictOldestSettled(() => true)) return false;
  }
  return true;
}

/** Empreinte d'un corps de requête, sans sa clé : deux envois du même geste la partagent. */
export function bodyFingerprint(body: object): string {
  return JSON.stringify(body, (name, value: unknown) => (name === "requestKey" ? undefined : value));
}

/**
 * Exécute `task` une fois par `(scope, key)` : une répétition rend le résultat
 * (ou attend l'exécution en cours) de la première. Sans clé, `task` s'exécute
 * simplement. Avec `fingerprint` (`bodyFingerprint`), une clé reprise **avec un
 * autre corps** est un autre geste : il s'exécute, sans rendre le résultat du
 * premier — une correction ne se perd pas sous un 201 qui n'est pas le sien.
 * Une portée qui a atteint son plafond d'entrées en cours ne retient plus le
 * nouveau geste : il s'exécute, mais sans rejeu possible.
 */
export function runOnce<T>(
  scope: string,
  key: string | null,
  task: () => Promise<T>,
  now: number = Date.now(),
  fingerprint: string | null = null,
): Promise<T> {
  if (key === null) return task();
  const id = `${scope}\u0000${key}`;
  const existing = entries.get(id);
  if (existing && (existing.expiresAt > now || !existing.settled)) {
    if (existing.fingerprint === null || fingerprint === null || existing.fingerprint === fingerprint) {
      return existing.result as Promise<T>;
    }
    return task();
  }
  if (!prune(now, scope)) return task();
  const result = task();
  const entry: Entry = { scope, expiresAt: now + IDEMPOTENCY_TTL_MS, result, fingerprint, settled: false };
  entries.set(id, entry);
  result.then(
    () => {
      entry.settled = true;
    },
    () => {
      // Un échec n'est pas retenu : la même clé peut retenter.
      if (entries.get(id) === entry) entries.delete(id);
    },
  );
  return result;
}

/** Comme `runOnce`, la clé et l'empreinte venant du corps reçu (`requestKey`). */
export function runOnceForBody<T>(scope: string, body: { requestKey?: unknown; [field: string]: unknown }, task: () => Promise<T>): Promise<T> {
  const key = readRequestKey(body.requestKey);
  return runOnce(scope, key, task, Date.now(), key === null ? null : bodyFingerprint(body));
}

/** Tests seulement : vide la mémoire des rejeux. */
export function resetIdempotencyForTests(): void {
  entries.clear();
}
