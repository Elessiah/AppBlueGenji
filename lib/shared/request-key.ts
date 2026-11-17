/**
 * Clé d'un geste envoyé au serveur (`lib/server/idempotency.ts`) : tirée **une
 * fois par geste**, renvoyée telle quelle par chaque nouvel essai, elle fait
 * rendre au serveur le résultat du premier envoi au lieu d'en refaire l'effet.
 *
 * Aléa cryptographique seulement (`crypto.randomUUID`, sinon
 * `crypto.getRandomValues`). Sans lui (navigateur hors d'usage), une clé
 * horodatée et numérotée : elle n'a pas à être secrète — le serveur la range
 * sous la portée de l'utilisateur, la clé d'un autre compte ne rend jamais son
 * résultat — seulement distincte d'un geste à l'autre.
 */
let fallbackCounter = 0;

export function newRequestKey(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  fallbackCounter += 1;
  return `k-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`.padEnd(16, "0");
}

/** Clé tirée pour un corps d'envoi précis (`keyForBody`). */
export type KeyedBody = { key: string; body: string };

/**
 * La clé d'un nouvel essai : celle de l'essai précédent si le corps envoyé est
 * **identique** (réponse perdue, même geste renvoyé), sinon une clé neuve. Un
 * formulaire corrigé après un échec est un autre geste : renvoyé sous l'ancienne
 * clé, le serveur rendrait le résultat du premier envoi et la correction serait
 * perdue sans un mot.
 */
export function keyForBody(previous: KeyedBody | null, body: string): KeyedBody {
  return previous !== null && previous.body === body ? previous : { key: newRequestKey(), body };
}

/**
 * Le corps d'un ajout muni de sa clé (`keyForBody`) ; la clé retenue est
 * rangée dans `slot` pour l'essai suivant. `slot.current = null` (ouverture
 * du formulaire) fait tirer une clé neuve au prochain envoi.
 */
export function withRequestKey<T extends object>(
  slot: { current: KeyedBody | null },
  payload: T,
): T & { requestKey: string } {
  const keyed = keyForBody(slot.current, JSON.stringify(payload));
  slot.current = keyed;
  return { ...payload, requestKey: keyed.key };
}
