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
