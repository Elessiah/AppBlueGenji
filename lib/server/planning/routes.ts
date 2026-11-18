import { failureDiagnostic } from "@/lib/server/failure-reason";
import { fail } from "@/lib/server/http";
import { isContentionError } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";
import { parsePlanningEntryKey, planningEntryKey } from "@/lib/shared/planning";
import { PLANNING_STATUSES } from "./actions";

/**
 * Traduit un refus d'un geste du planning en réponse : un code connu
 * ({@link PLANNING_STATUSES}) garde son statut, une contention passagère dit
 * « réessaie », le reste est une panne (500, code seul au journal).
 */
export function planningFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const status = Object.hasOwn(PLANNING_STATUSES, message) ? PLANNING_STATUSES[message] : undefined;
  if (status) return fail(message, status);
  if (isContentionError(error)) return fail(CONCURRENT_UPDATE_RETRY, 409);
  console.error("[planning] échec", failureDiagnostic(error));
  return fail(fallback, 500);
}

/** Clé d'entrée lue dans un corps (`m:<id>` / `t:<id>`), normalisée ; `null` si illisible. */
export function readEntryKey(value: unknown): string | null {
  const parsed = parsePlanningEntryKey(value);
  return parsed ? planningEntryKey(parsed.kind, parsed.id) : null;
}
