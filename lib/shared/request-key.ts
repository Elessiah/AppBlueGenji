/**
 * Clé d'un geste envoyé au serveur (`lib/server/idempotency.ts`) : tirée **une
 * fois par geste**, renvoyée telle quelle par chaque nouvel essai, elle fait
 * rendre au serveur le résultat du premier envoi au lieu d'en refaire l'effet.
 *
 * `crypto.randomUUID()` quand le navigateur l'offre (contexte sécurisé), sinon
 * un repli aléatoire de même forme acceptée par le serveur.
 */
export function newRequestKey(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
