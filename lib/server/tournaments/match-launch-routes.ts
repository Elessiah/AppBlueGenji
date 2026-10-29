import { fail } from "@/lib/server/http";
import { isDeadlockMessage } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";
import { isSnapshotConflict } from "./deadlock-retry";
import type { CastTarget } from "./match-launch";

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
  // Interblocage : le message brut passe, `fail()` le rend en « réessaie ».
  if (isDeadlockMessage(message)) return fail(message, 500);
  // Ligne changée depuis l'instantané (MariaDB, `ER_CHECKREAD`) à chaque
  // rejeu : un conflit « réessaie », pas une panne.
  if (isSnapshotConflict(error)) return fail(CONCURRENT_UPDATE_RETRY, 409);
  console.error("[match-launch] échec", error);
  return fail(fallback, 500);
}

/** Entier strictement positif (identifiant). */
export function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Le stream choisi : `{ streamId }` rejoint un stream du match (co-cast),
 * `{ liveUrl }` en ouvre un — `null` ou absent : sans lien. Les deux à la fois,
 * ou un type inattendu, sont refusés.
 */
export function parseCastTarget(body: unknown): CastTarget | null {
  const { streamId, liveUrl } = (typeof body === "object" && body !== null ? body : {}) as {
    streamId?: unknown;
    liveUrl?: unknown;
  };
  if (streamId !== undefined && liveUrl !== undefined) return null;
  if (streamId !== undefined) return isPositiveId(streamId) ? { streamId } : null;
  if (liveUrl === undefined || liveUrl === null) return { liveUrl: null };
  return typeof liveUrl === "string" ? { liveUrl } : null;
}
