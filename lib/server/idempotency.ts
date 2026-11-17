import { createHash } from "node:crypto";

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
 * La clé est rangée sous une portée qui nomme la route et l'utilisateur (la
 * cible éventuelle s'ajoute à l'identifiant de l'entrée) : la clé d'un autre
 * compte ne rend jamais son résultat. La route vérifie le droit **avant**
 * l'appel : un droit retiré ne reçoit jamais un succès rejoué.
 */

/** Durée pendant laquelle une répétition rend le résultat de la première (entrée en cours comprise). */
export const IDEMPOTENCY_TTL_MS = 10 * 60_000;
/**
 * Plafond d'entrées gardées : au-delà, part la plus ancienne **terminée** de la
 * portée la plus fournie — un compte qui remplit ses portées n'évince pas les
 * entrées des comptes plus discrets.
 */
export const IDEMPOTENCY_MAX_ENTRIES = 2_000;
/**
 * Plafond d'entrées gardées par portée (route + utilisateur, toutes cibles
 * confondues) : un compte qui enverrait des clés neuves en rafale n'use que sa
 * propre part.
 */
export const IDEMPOTENCY_MAX_PER_SCOPE = 100;

/** Forme d'une clé acceptée : celle de `crypto.randomUUID()` ou du repli. */
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

type Entry = {
  expiresAt: number;
  result: Promise<unknown>;
  /** Une tâche en cours n'est jamais évincée par les plafonds (sa répétition l'attend), seulement par l'échéance. */
  settled: boolean;
};

/** Portée → (clé, cible, empreinte) → entrée ; chaque `Map` garde l'ordre d'insertion (les premières sont les plus anciennes). */
const scopes = new Map<string, Map<string, Entry>>();
let total = 0;

/** La clé de requête d'un corps reçu, ou `null` (absente ou mal formée : pas de rejeu). */
export function readRequestKey(value: unknown): string | null {
  return typeof value === "string" && REQUEST_KEY_PATTERN.test(value) ? value : null;
}

function remove(scope: string, bucket: Map<string, Entry>, id: string): void {
  if (!bucket.delete(id)) return;
  total -= 1;
  if (bucket.size === 0 && scopes.get(scope) === bucket) scopes.delete(scope);
}

function sweepExpired(scope: string, bucket: Map<string, Entry>, now: number): void {
  for (const [id, entry] of bucket) if (entry.expiresAt <= now) remove(scope, bucket, id);
}

function evictOldestSettled(scope: string, bucket: Map<string, Entry>): boolean {
  for (const [id, entry] of bucket) {
    if (entry.settled) {
      remove(scope, bucket, id);
      return true;
    }
  }
  return false;
}

/** Fait de la place dans la portée puis dans le total ; faux si tout ce qui pourrait partir est en cours. */
function prune(now: number, scope: string): boolean {
  const own = scopes.get(scope);
  if (own) {
    sweepExpired(scope, own, now);
    while (own.size >= IDEMPOTENCY_MAX_PER_SCOPE) if (!evictOldestSettled(scope, own)) return false;
  }
  if (total < IDEMPOTENCY_MAX_ENTRIES) return true;
  // Le balayage complet n'a lieu qu'au plafond.
  for (const [name, bucket] of scopes) sweepExpired(name, bucket, now);
  while (total >= IDEMPOTENCY_MAX_ENTRIES) {
    const bySize = [...scopes].sort((a, b) => b[1].size - a[1].size);
    if (!bySize.some(([name, bucket]) => evictOldestSettled(name, bucket))) return false;
  }
  return true;
}

/** Copie aux clés triées : deux corps égaux à l'ordre près des champs ont la même empreinte. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const name of Object.keys(value).sort((a, b) => a.localeCompare(b, "en"))) {
    sorted[name] = canonical((value as Record<string, unknown>)[name]);
  }
  return sorted;
}

/**
 * Empreinte d'un corps de requête sans sa clé (`requestKey` de premier niveau) :
 * deux envois du même geste la partagent. Un condensé SHA-256 de taille fixe
 * — l'entrée ne garde jamais le corps lui-même.
 */
export function bodyFingerprint(body: object): string {
  const rest: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete rest.requestKey;
  return createHash("sha256").update(JSON.stringify(canonical(rest))).digest("hex");
}

export type RunOnceOptions<T> = {
  /** Cible du geste (tournoi, engagé…) : sépare les entrées sans créer une portée de plus. */
  target?: string;
  /**
   * Relit l'objet rendu avant de le rejouer : sa version actuelle, ou `null`
   * s'il a disparu entre-temps — l'entrée est alors oubliée et le geste
   * s'exécute de nouveau au lieu de rendre un objet supprimé.
   */
  fresh?: (cached: T) => Promise<T | null>;
};

/**
 * Exécute `task` une fois par `(scope, key, cible, empreinte)` : une répétition
 * rend le résultat (ou attend l'exécution en cours) de la première. Sans clé,
 * `task` s'exécute simplement. L'empreinte (`bodyFingerprint`) fait partie de
 * l'identifiant : une clé reprise **avec un autre corps** est un autre geste,
 * exécuté et retenu à son tour — une correction ne se perd pas sous un 201 qui
 * n'est pas le sien, et son propre renvoi est rejoué. Une portée pleine
 * d'entrées en cours ne retient plus le nouveau geste : il s'exécute, sans rejeu.
 */
export function runOnce<T>(
  scope: string,
  key: string | null,
  task: () => Promise<T>,
  now: number = Date.now(),
  fingerprint: string | null = null,
  options: RunOnceOptions<T> = {},
): Promise<T> {
  if (key === null) return task();
  const id = `${key}\u0000${options.target ?? ""}\u0000${fingerprint ?? ""}`;
  const bucket = scopes.get(scope);
  const existing = bucket?.get(id);
  if (bucket && existing && existing.expiresAt > now) {
    const replay = existing.result as Promise<T>;
    const { fresh } = options;
    if (!fresh) return replay;
    return replay.then(async (value) => {
      const current = await fresh(value);
      if (current !== null) return current;
      if (bucket.get(id) === existing) remove(scope, bucket, id);
      return runOnce(scope, key, task, now, fingerprint, options);
    });
  }
  if (!prune(now, scope)) return task();
  const result = task();
  const entry: Entry = { expiresAt: now + IDEMPOTENCY_TTL_MS, result, settled: false };
  let owner = scopes.get(scope);
  if (!owner) {
    owner = new Map();
    scopes.set(scope, owner);
  }
  // Une entrée échue du même identifiant a été balayée par `prune`.
  owner.set(id, entry);
  total += 1;
  const home = owner;
  result.then(
    () => {
      entry.settled = true;
    },
    () => {
      // Un échec n'est pas retenu : la même clé peut retenter.
      if (home.get(id) === entry) remove(scope, home, id);
    },
  );
  return result;
}

/** Comme `runOnce`, la clé et l'empreinte venant du corps reçu (`requestKey`). */
export function runOnceForBody<T>(
  scope: string,
  body: { requestKey?: unknown; [field: string]: unknown },
  task: () => Promise<T>,
  options: RunOnceOptions<T> = {},
): Promise<T> {
  const key = readRequestKey(body.requestKey);
  return runOnce(scope, key, task, Date.now(), key === null ? null : bodyFingerprint(body), options);
}

/** Tests seulement : nombre d'entrées gardées. */
export function idempotencyEntryCountForTests(): number {
  return total;
}

/** Tests seulement : vide la mémoire des rejeux. */
export function resetIdempotencyForTests(): void {
  scopes.clear();
  total = 0;
}
