import { fail } from "@/lib/server/http";

/** Identifiant de match lu dans un segment d'URL : entier strictement positif. */
export function parseMatchIdParam(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Traduit un refus du service de lancement en réponse HTTP, d'après une table
 * fermée : un code absent de la table est une vraie panne (500).
 */
export function launchFailure(
  error: unknown,
  statuses: Readonly<Record<string, number>>,
  fallback: string,
) {
  const message = (error as Error).message;
  const status = statuses[message];
  if (status) return fail(message, status);
  console.error("[match-launch] échec", error);
  return fail(fallback, 500);
}
